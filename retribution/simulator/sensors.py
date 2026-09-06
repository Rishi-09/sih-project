"""
Deterministic nominal sensor models for Rotax 915 iS A / iSC A Turbocharged & Fuel-Injected Aero Engine.
All sensors mapped from flight context with TCU turbo boost, FADEC EFI injection timing,
multi-cylinder torsional vibration dynamics, atmospheric ISA physics, and derived CHT pass.
"""

from typing import Dict, Any, List, Optional
import numpy as np
from .config import Rotax915Config, DEFAULT_CONFIG

def compute_derived_cht(coolant_temp_c: float, fuel_flow_lph: float, egts: List[float]) -> List[float]:
    """
    Computes physics-informed derived CHT for all 4 cylinders:
      cht_k = coolant_temp_c + 25.0 + 0.3 * (fuel_flow_lph - 12.0) + 0.15 * (egt_k - mean(egt_1..4))
    """
    mean_egt = float(np.mean(egts))
    chts = []
    for k in range(4):
        cht_k = coolant_temp_c + 25.0 + 0.3 * (fuel_flow_lph - 12.0) + 0.15 * (egts[k] - mean_egt)
        chts.append(float(cht_k))
    return chts


class NominalSensorModel:
    """
    Computes nominal (healthy) sensor targets for all 19 engine channels
    based on flight context: throttle_pct, alt_m, oat_c, ias_kt, phase.
    """
    def __init__(self, config: Rotax915Config = DEFAULT_CONFIG):
        self.cfg = config

    @staticmethod
    def compute_air_density(alt_m: float) -> float:
        """Standard ISA atmospheric air density rho(h) in kg/m^3."""
        rho_0 = 1.225
        t0_k = 288.15
        lapse = 0.0065
        t_k = max(200.0, t0_k - lapse * alt_m)
        return float(rho_0 * ((t_k / t0_k) ** 4.2561))

    @staticmethod
    def compute_ram_air_coefficient(ias_kt: float, alt_m: float) -> float:
        """Ram-air heat transfer convection coefficient multiplier h_air."""
        rho = NominalSensorModel.compute_air_density(alt_m)
        rho_0 = 1.225
        density_factor = max(0.2, rho / rho_0) ** 0.8
        speed_factor = np.sqrt(max(10.0, ias_kt) / 100.0)
        return float(speed_factor * density_factor)

    def _ambient_pressure_ratio(self, alt_m: float) -> float:
        """Standard ISA atmospheric pressure ratio P(h) / P_0."""
        t0_k = 288.15
        lapse = 0.0065
        t_k = max(200.0, t0_k - lapse * alt_m)
        return float((t_k / t0_k) ** 5.2561)

    def compute_torsional_vibration(self, base_vib: float, misfire_factors: Optional[List[float]] = None) -> float:
        """
        Multi-cylinder harmonic torsional vibration model.
        In a 4-stroke 4-cylinder engine, firing occurs every 180 deg crank angle over 720 deg (4*pi).
        If a cylinder misfires (misfire_factor < 1.0), cyclic torque variation increases vibration roughness.
        """
        if misfire_factors is None:
            misfire_factors = [1.0, 1.0, 1.0, 1.0]

        # Calculate cylinder torque deficit / asymmetry
        min_factor = float(np.min(misfire_factors))
        torque_imbalance = max(0.0, 1.0 - min_factor)
        added_vib = 0.25 * (torque_imbalance ** 1.2)

        torsion_vib = base_vib + added_vib
        return float(np.clip(torsion_vib, self.cfg.vib_normal_min, self.cfg.vib_redline))

    def compute_nominal_targets(self, context: Dict[str, Any]) -> Dict[str, float]:
        """
        Compute steady-state target values for 15 independently-sampled engine channels + 4 derived CHTs.
        """
        throttle = float(np.clip(context.get("throttle_pct", 0.0), 0.0, 100.0))
        alt_m = float(max(0.0, context.get("alt_m", 0.0)))
        oat_c = float(context.get("oat_c", 15.0))
        ias_kt = float(max(0.0, context.get("ias_kt", 0.0)))
        phase = str(context.get("phase", "CRUISE")).upper()

        u = throttle / 100.0  # Normalized throttle 0.0 -> 1.0

        # -------------------------------------------------------------
        # 1. RPM & Mechanical Vibration (Independently Sampled)
        # -------------------------------------------------------------
        if phase in ("STARTUP", "SHUTDOWN") and u < 0.05:
            target_rpm = 0.0 if phase == "SHUTDOWN" and u == 0.0 else self.cfg.rpm_idle * 0.5
        else:
            base_rpm = self.cfg.rpm_idle + (self.cfg.rpm_max_takeoff - self.cfg.rpm_idle) * (u ** 0.85)
            airspeed_effect = (ias_kt - 70.0) * 0.45
            target_rpm = np.clip(base_rpm + airspeed_effect, self.cfg.rpm_idle, self.cfg.rpm_max_takeoff)

        base_vib = self.cfg.vib_normal_min + (self.cfg.vib_normal_max - self.cfg.vib_normal_min) * (u ** 1.1)
        target_vib = self.compute_torsional_vibration(base_vib)

        # -------------------------------------------------------------
        # 2. MAP (Manifold Absolute Pressure) - Turbocharger TCU Model
        # -------------------------------------------------------------
        p_ratio = self._ambient_pressure_ratio(alt_m)
        p_crit_ratio = self._ambient_pressure_ratio(self.cfg.critical_altitude_m)
        
        # Piecewise calibrated throttle -> MAP curve
        if u <= 0.15:
            base_map = self.cfg.map_idle + (u / 0.15) * (60.0 - self.cfg.map_idle)
        elif u <= 0.70:
            base_map = 60.0 + ((u - 0.15) / 0.55) * (self.cfg.map_cruise - 60.0)
        elif u <= 0.90:
            base_map = self.cfg.map_cruise + ((u - 0.70) / 0.20) * (self.cfg.map_max_continuous - self.cfg.map_cruise)
        else:
            base_map = self.cfg.map_max_continuous + ((u - 0.90) / 0.10) * (self.cfg.map_takeoff_boost - self.cfg.map_max_continuous)

        # Turbo TCU altitude compensation (flat up to 4800m critical altitude)
        if alt_m <= self.cfg.critical_altitude_m:
            target_map = base_map
        else:
            altitude_loss_factor = p_ratio / max(0.01, p_crit_ratio)
            target_map = max(self.cfg.map_idle, base_map * altitude_loss_factor)

        # -------------------------------------------------------------
        # 3. Fuel System & Electronic Injection
        # -------------------------------------------------------------
        flow_ratio = (target_rpm / self.cfg.rpm_max_takeoff) * (target_map / self.cfg.map_takeoff_boost)
        target_fuel_flow = self.cfg.fuel_flow_idle + (self.cfg.fuel_flow_takeoff - self.cfg.fuel_flow_idle) * (flow_ratio ** 1.1)
        target_fuel_flow = float(np.clip(target_fuel_flow, self.cfg.fuel_flow_idle, self.cfg.fuel_flow_takeoff))

        # Electronic Fuel Injection (EFI) regulated rail pressure (3.0 bar nominal)
        target_fuel_press = float(self.cfg.fuel_press_nominal)

        # FADEC Electronic Injection Timing (°BTDC)
        target_inj_timing = 22.0 + (u * 4.5)  # 22° at idle -> 26.5° at cruise -> 28° at takeoff

        # -------------------------------------------------------------
        # 4. Oil Temperature & Pressure (RPM-conditional limits)
        # -------------------------------------------------------------
        power_heat_oil = 18.0 * (u ** 1.1)
        ambient_effect_oil = np.clip((oat_c - 15.0) * 0.20, -6.0, 10.0)
        h_ram = self.compute_ram_air_coefficient(ias_kt, alt_m)
        cooling_air_oil = np.clip(h_ram * 4.0, 0.0, 6.0)
        target_oil_temp = 85.0 + power_heat_oil + ambient_effect_oil - cooling_air_oil
        target_oil_temp = float(np.clip(target_oil_temp, self.cfg.oil_temp_min, self.cfg.oil_temp_redline - 5.0))

        viscosity_loss = max(0.0, (target_oil_temp - 90.0) * 0.025)
        rpm_ratio = (target_rpm - self.cfg.rpm_idle) / max(1.0, self.cfg.rpm_max_continuous - self.cfg.rpm_idle)
        min_press_floor = self.cfg.oil_press_min_idle if target_rpm < 3500.0 else self.cfg.oil_press_min_continuous
        base_oil_press = min_press_floor + rpm_ratio * (self.cfg.oil_press_normal_max - min_press_floor)
        target_oil_press = float(np.clip(base_oil_press - viscosity_loss, self.cfg.oil_press_min_idle, self.cfg.oil_press_normal_max))

        # -------------------------------------------------------------
        # 5. Liquid Coolant (Measured Channel)
        # -------------------------------------------------------------
        power_heat_coolant = 22.0 * (u ** 1.25)
        ambient_effect_coolant = (oat_c - 15.0) * 0.40
        cooling_air_coolant = np.clip(h_ram * 7.5, 0.0, 9.0)
        target_coolant = 75.0 + power_heat_coolant + ambient_effect_coolant - cooling_air_coolant
        target_coolant = float(np.clip(target_coolant, self.cfg.coolant_normal_min, self.cfg.coolant_caution_max - 5.0))

        # -------------------------------------------------------------
        # 6. EGT 1..4 (Measured Channels)
        # -------------------------------------------------------------
        if u < 0.2:
            base_egt = 730.0 + (u / 0.2) * 50.0
        elif u <= 0.75:
            base_egt = 780.0 + ((u - 0.2) / 0.55) * 65.0
        else:
            base_egt = 845.0 - ((u - 0.75) / 0.25) * 35.0

        cyl_egt_offsets = [-4.0, 5.0, 3.0, -3.0]
        target_egts = [
            float(np.clip(base_egt + off, self.cfg.egt_normal_min - 30.0, self.cfg.egt_caution_max - 20.0))
            for off in cyl_egt_offsets
        ]

        # -------------------------------------------------------------
        # 7. Derivation Pass for CHT 1..4 (Modeled Estimate from §0)
        #    cht_k = coolant_temp_c + 25 + 0.3*(fuel_flow_lph - 12) + 0.15*(egt_k - mean(egts))
        # -------------------------------------------------------------
        target_chts = compute_derived_cht(target_coolant, target_fuel_flow, target_egts)

        # -------------------------------------------------------------
        # 8. Electrical Subsystem (Measured Channels)
        # -------------------------------------------------------------
        if target_rpm > 1800.0:
            target_bus_v = self.cfg.bus_voltage_nominal
            target_alt_a = 18.0 + (u * 12.0)
        else:
            target_bus_v = 12.6 + (target_rpm / 1800.0) * 1.4
            target_alt_a = max(0.0, (target_rpm / 1800.0) * 15.0)

        return {
            "rpm": float(target_rpm),
            "vib_rms_g": target_vib,
            "egt_1": target_egts[0],
            "egt_2": target_egts[1],
            "egt_3": target_egts[2],
            "egt_4": target_egts[3],
            "cht_1": target_chts[0],
            "cht_2": target_chts[1],
            "cht_3": target_chts[2],
            "cht_4": target_chts[3],
            "coolant_temp_c": float(target_coolant),
            "oil_press_bar": float(target_oil_press),
            "oil_temp_c": float(target_oil_temp),
            "map_kpa": float(target_map),
            "fuel_flow_lph": target_fuel_flow,
            "fuel_press_bar": target_fuel_press,
            "inj_timing_deg": float(target_inj_timing),
            "bus_voltage_v": float(target_bus_v),
            "alt_current_a": float(target_alt_a),
        }
