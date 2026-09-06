-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Frame" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" TEXT NOT NULL,
    "t" INTEGER NOT NULL,
    "ts" DATETIME NOT NULL,
    "phase" TEXT NOT NULL,
    "rpm" REAL NOT NULL,
    "mapKpa" REAL NOT NULL,
    "egt1" REAL NOT NULL,
    "egt2" REAL NOT NULL,
    "egt3" REAL NOT NULL,
    "egt4" REAL NOT NULL,
    "cht1" REAL NOT NULL,
    "cht2" REAL NOT NULL,
    "cht3" REAL NOT NULL,
    "cht4" REAL NOT NULL,
    "oilPressBar" REAL NOT NULL,
    "oilTempC" REAL NOT NULL,
    "coolantTempC" REAL NOT NULL,
    "fuelFlowLph" REAL NOT NULL,
    "fuelPressBar" REAL NOT NULL,
    "injTimingDeg" REAL NOT NULL,
    "vibRmsG" REAL NOT NULL,
    "busVoltageV" REAL NOT NULL,
    "altCurrentA" REAL NOT NULL,
    "context" TEXT NOT NULL,
    "residualZ" TEXT NOT NULL,
    "health" TEXT NOT NULL,
    "ehi" REAL,
    "faultLabel" TEXT,
    "confidence" REAL,
    "rulSec" INTEGER,
    "pSuccess" REAL,
    "sensorFaultChannel" TEXT,
    "sensorFaultMode" TEXT,
    CONSTRAINT "Frame_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Frame" ("altCurrentA", "busVoltageV", "cht1", "cht2", "cht3", "cht4", "confidence", "context", "coolantTempC", "egt1", "egt2", "egt3", "egt4", "ehi", "faultLabel", "fuelFlowLph", "fuelPressBar", "health", "id", "injTimingDeg", "mapKpa", "oilPressBar", "oilTempC", "pSuccess", "phase", "residualZ", "rpm", "rulSec", "runId", "sensorFaultChannel", "sensorFaultMode", "t", "ts", "vibRmsG") SELECT "altCurrentA", "busVoltageV", "cht1", "cht2", "cht3", "cht4", "confidence", "context", "coolantTempC", "egt1", "egt2", "egt3", "egt4", "ehi", "faultLabel", "fuelFlowLph", "fuelPressBar", "health", "id", "injTimingDeg", "mapKpa", "oilPressBar", "oilTempC", "pSuccess", "phase", "residualZ", "rpm", "rulSec", "runId", "sensorFaultChannel", "sensorFaultMode", "t", "ts", "vibRmsG" FROM "Frame";
DROP TABLE "Frame";
ALTER TABLE "new_Frame" RENAME TO "Frame";
CREATE INDEX "Frame_runId_t_idx" ON "Frame"("runId", "t");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
