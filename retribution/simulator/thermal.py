"""
Thermal inertia dynamics, lumped capacitance differential network, and realistic avionics noise models.
Implements:
1. Lumped Thermal Capacitance Differential Network (dT/dt ODEs for CHT, coolant, oil, EGT).
2. First-order low pass filter for non-thermal channels.
3. Realistic Avionics Sensor Noise Engine:
   - 1/f Pink Noise (AR-1 autoregressive spectral shaping)
   - Multi-channel physical cross-correlation
   - Microcontroller 10-bit / 12-bit ADC quantization
   - Alternator / Ignition EMI ripple on DC bus voltage
   - CAN bus frame dropouts (Zero-Order Hold)
"""

from typing import Dict, Optional, List, Any
import numpy as np

def compute_derived_cht(coolant_temp_c: float, fuel_flow_lph: float, egts: List[float]) -> List[float]:
    """
    Derived CHT formula for Rotax 915 iS:
    cht_k = coolant_temp_c + 25.0 + 0.3 * (fuel_flow_lph - 12.0) + 0.15 * (egt_k - mean(egt_1..4))
    """
    mean_egt = float(np.mean(egts))
    return [
        float(coolant_temp_c + 25.0 + 0.3 * (fuel_flow_lph - 12.0) + 0.15 * (egts[k] - mean_egt))
        for k in range(4)
    ]


class FirstOrderLag:
    """
    First-order low-pass lag filter:
        y[k] = alpha * x[k] + (1 - alpha) * y[k-1]
        alpha = 1 - exp(-dt / tau)
    """
    def __init__(self, tau_s: float, dt_s: float = 1.0, initial_value: float = 0.0):
        self.tau_s = max(0.01, tau_s)
        self.dt_s = dt_s
        self.alpha = 1.0 - np.exp(-self.dt_s / self.tau_s)
        self.state = initial_value

    def reset(self, value: float):
        self.state = value

    def update(self, target_value: float) -> float:
        self.state = (self.alpha * target_value) + ((1.0 - self.alpha) * self.state)
        return float(self.state)


class ThermalCapacitanceNetwork:
    """
    Lumped Thermal Capacitance Differential Network.
    Solves coupled differential equations (dT/dt) for:
    - Cylinder Head Temperatures (CHT 1..4)
    - Liquid Coolant Circuit
    - Engine Oil Sump
    - Exhaust Gas Temperature (EGT 1..4)
    """
    def __init__(self, dt_s: float = 1.0):
        self.dt = dt_s
        # Thermal time constants (tau = R * C)
        self.tau_egt = 0.8
        self.tau_cht = 15.0
        self.tau_coolant = 25.0
        self.tau_oil = 45.0

        # State storage
        self.t_oil = 90.0
        self.t_coolant = 85.0
        self.t_egts = [800.0, 800.0, 800.0, 800.0]
        self.t_chts = [105.0, 105.0, 105.0, 105.0]
        self.is_initialized = False

    def initialize(self, targets: Dict[str, float]):
        self.t_oil = targets.get("oil_temp_c", 90.0)
        self.t_coolant = targets.get("coolant_temp_c", 85.0)
        self.t_egts = [targets.get(f"egt_{i}", 800.0) for i in range(1, 5)]
        self.t_chts = [targets.get(f"cht_{i}", 105.0) for i in range(1, 5)]
        self.is_initialized = True

    def update(self, targets: Dict[str, float], context: Optional[Dict[str, Any]] = None) -> Dict[str, float]:
        """
        Advance thermal state by 1 second using Euler numerical integration.
        """
        if not self.is_initialized:
            self.initialize(targets)

        # 1. Update EGTs (Fast gas thermal dynamics)
        alpha_egt = 1.0 - np.exp(-self.dt / self.tau_egt)
        for i in range(4):
            target_egt = targets.get(f"egt_{i+1}", 800.0)
            self.t_egts[i] += alpha_egt * (target_egt - self.t_egts[i])

        # 2. Update Coolant (Jacket fluid loop dynamics)
        target_coolant = targets.get("coolant_temp_c", 85.0)
        alpha_coolant = 1.0 - np.exp(-self.dt / self.tau_coolant)
        self.t_coolant += alpha_coolant * (target_coolant - self.t_coolant)

        # 3. Update Oil Sump (High thermal mass oil volume)
        target_oil = targets.get("oil_temp_c", 90.0)
        alpha_oil = 1.0 - np.exp(-self.dt / self.tau_oil)
        self.t_oil += alpha_oil * (target_oil - self.t_oil)

        # 4. Update CHTs (Coupled to combustion heat + coolant jacket + EGT balance)
        fuel_flow = targets.get("fuel_flow_lph", 22.0)
        steady_state_chts = compute_derived_cht(self.t_coolant, fuel_flow, self.t_egts)
        alpha_cht = 1.0 - np.exp(-self.dt / self.tau_cht)
        for i in range(4):
            self.t_chts[i] += alpha_cht * (steady_state_chts[i] - self.t_chts[i])

        return {
            "oil_temp_c": float(self.t_oil),
            "coolant_temp_c": float(self.t_coolant),
            "egt_1": float(self.t_egts[0]),
            "egt_2": float(self.t_egts[1]),
            "egt_3": float(self.t_egts[2]),
            "egt_4": float(self.t_egts[3]),
            "cht_1": float(self.t_chts[0]),
            "cht_2": float(self.t_chts[1]),
            "cht_3": float(self.t_chts[2]),
            "cht_4": float(self.t_chts[3]),
        }


class SensorLagBank:
    """
    Manages dynamic lag across all engine channels:
    - Thermal channels are managed by ThermalCapacitanceNetwork (coupled dT/dt).
    - Mechanical, hydraulic, and electrical channels are managed by FirstOrderLag.
    """
    DEFAULT_NON_THERMAL_TAUS: Dict[str, float] = {
        "rpm": 1.2,
        "vib_rms_g": 0.5,
        "oil_press_bar": 2.0,
        "map_kpa": 0.8,
        "fuel_flow_lph": 1.5,
        "fuel_press_bar": 1.0,
        "inj_timing_deg": 0.5,
        "bus_voltage_v": 0.5,
        "alt_current_a": 1.0,
    }

    def __init__(self, time_constants: Optional[Dict[str, float]] = None):
        taus = time_constants or self.DEFAULT_NON_THERMAL_TAUS
        self.non_thermal_filters: Dict[str, FirstOrderLag] = {
            channel: FirstOrderLag(tau_s=tau)
            for channel, tau in taus.items()
        }
        self.thermal_network = ThermalCapacitanceNetwork(dt_s=1.0)
        self.is_initialized = False

    def initialize(self, initial_values: Dict[str, float]):
        for channel, val in initial_values.items():
            if channel in self.non_thermal_filters:
                self.non_thermal_filters[channel].reset(val)
        self.thermal_network.initialize(initial_values)
        self.is_initialized = True

    def apply(self, targets: Dict[str, float], context: Optional[Dict[str, Any]] = None) -> Dict[str, float]:
        """Apply lag across non-thermal and thermal channels."""
        if not self.is_initialized:
            self.initialize(targets)

        lagged: Dict[str, float] = {}

        # 1. Non-thermal channels (first order filters)
        for channel, val in targets.items():
            if channel in self.non_thermal_filters:
                lagged[channel] = self.non_thermal_filters[channel].update(val)
            elif not channel.startswith("egt_") and not channel.startswith("cht_") and channel not in ("oil_temp_c", "coolant_temp_c"):
                lagged[channel] = val

        # 2. Thermal channels (differential capacitance network)
        thermal_out = self.thermal_network.update(targets, context=context)
        lagged.update(thermal_out)

        return lagged


class CorrelatedNoiseEngine:
    """
    Realistic Avionics Sensor Noise Engine.
    Features:
    - 1/f Pink Noise (AR-1 autoregressive model for atmospheric turbulence & 1/f flicker)
    - Cross-channel physical correlation (shared combustion pulses & mechanical harmonics)
    - ADC Quantization (10-bit / 12-bit LSB discretization)
    - Alternator EMI ripple on DC bus voltage
    - CAN bus Zero-Order Hold (ZOH) frame dropouts
    """
    def __init__(self, seed: Optional[int] = None):
        self.rng = np.random.default_rng(seed)
        self.phi = 0.92  # Pink noise AR(1) coefficient
        self.pink_states: Dict[str, float] = {}
        self.prev_frame: Dict[str, float] = {}

        # ADC step sizes (LSB resolution)
        self.adc_resolutions: Dict[str, float] = {
            "egt_1": 0.5, "egt_2": 0.5, "egt_3": 0.5, "egt_4": 0.5,
            "cht_1": 0.25, "cht_2": 0.25, "cht_3": 0.25, "cht_4": 0.25,
            "oil_temp_c": 0.25, "coolant_temp_c": 0.25,
            "oil_press_bar": 0.01, "fuel_press_bar": 0.01,
            "map_kpa": 0.05, "fuel_flow_lph": 0.05,
            "bus_voltage_v": 0.02, "alt_current_a": 0.1,
            "rpm": 1.0, "vib_rms_g": 0.001, "inj_timing_deg": 0.1
        }

    def _pink_step(self, channel: str, std_dev: float) -> float:
        """Compute AR(1) pink noise step."""
        prev = self.pink_states.get(channel, 0.0)
        innovation = self.rng.normal(0.0, std_dev)
        val = (self.phi * prev) + (np.sqrt(1.0 - self.phi**2) * innovation)
        self.pink_states[channel] = val
        return float(val)

    def generate(self, rpm: float = 5000.0, t_s: float = 0.0) -> Dict[str, float]:
        """
        Generate correlated noise additions for all 19 channels.
        """
        # Shared physical noise sources
        shared_exhaust_egt = self._pink_step("shared_exhaust", 3.2)     # Combustion pulse jitter (°C)
        shared_mechanical  = self._pink_step("shared_mech", 0.012)      # Mechanical vibration (g)
        shared_hydraulic   = self._pink_step("shared_hyd", 0.035)       # Oil/fuel pressure ripple (bar)

        noise: Dict[str, float] = {}

        # 1. EGTs (75% shared exhaust + 25% independent flame jitter)
        for i in range(1, 5):
            indep = self._pink_step(f"egt_{i}", 1.5)
            noise[f"egt_{i}"] = shared_exhaust_egt + indep

        # 2. Injection timing (°BTDC)
        noise["inj_timing_deg"] = self._pink_step("inj_timing_deg", 0.08)

        # 3. Oil & Coolant
        noise["oil_temp_c"] = self._pink_step("oil_temp_c", 0.10)
        noise["coolant_temp_c"] = self._pink_step("coolant_temp_c", 0.12)
        noise["oil_press_bar"] = shared_hydraulic + self._pink_step("oil_press_bar", 0.015)

        # 4. Induction & Fuel
        noise["map_kpa"] = self._pink_step("map_kpa", 0.30)
        noise["fuel_press_bar"] = (0.5 * shared_hydraulic) + self._pink_step("fuel_press_bar", 0.01)
        noise["fuel_flow_lph"] = self._pink_step("fuel_flow_lph", 0.20)

        # 5. Mechanical & RPM
        noise["vib_rms_g"] = shared_mechanical + self._pink_step("vib_rms_g", 0.004)
        noise["rpm"] = (shared_mechanical * 350.0) + self._pink_step("rpm", 6.0)

        # 6. Electrical (with Alternator EMI ripple)
        # Alternator ripple: 4-pole firing at (4 * RPM / 60) Hz
        emi_freq = max(10.0, (4.0 * rpm) / 60.0)
        emi_ripple = 0.06 * np.sin(2.0 * np.pi * emi_freq * t_s)
        noise["bus_voltage_v"] = self._pink_step("bus_voltage_v", 0.03) + emi_ripple
        noise["alt_current_a"] = self._pink_step("alt_current_a", 0.25)

        # 7. CHTs (CHTs derive noise through physical coupling)
        for i in range(1, 5):
            noise[f"cht_{i}"] = 0.0

        return noise

    def quantize(self, channel: str, value: float) -> float:
        """Apply ADC discretization step size."""
        lsb = self.adc_resolutions.get(channel, 0.01)
        return float(np.round(value / lsb) * lsb)

    def check_can_dropout(self, channel: str, value: float) -> float:
        """Apply 0.05% probability CAN frame hold (ZOH)."""
        if self.rng.random() < 0.0005 and channel in self.prev_frame:
            return self.prev_frame[channel]
        self.prev_frame[channel] = value
        return value
