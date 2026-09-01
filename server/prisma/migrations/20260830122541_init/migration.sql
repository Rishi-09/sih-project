-- CreateTable
CREATE TABLE "Engine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tail" TEXT NOT NULL,
    "model" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engineId" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "missionProfile" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "Run_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "Engine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Frame" (
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
    "ehi" REAL NOT NULL,
    "faultLabel" TEXT,
    "confidence" REAL,
    "rulSec" INTEGER,
    "pSuccess" REAL,
    "sensorFaultChannel" TEXT,
    "sensorFaultMode" TEXT,
    CONSTRAINT "Frame_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "t" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "clearedAtT" INTEGER,
    "ackedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Alert_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "metrics" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Engine_tail_key" ON "Engine"("tail");

-- CreateIndex
CREATE INDEX "Run_engineId_startedAt_idx" ON "Run"("engineId", "startedAt");

-- CreateIndex
CREATE INDEX "Frame_runId_t_idx" ON "Frame"("runId", "t");

-- CreateIndex
CREATE INDEX "Alert_runId_t_idx" ON "Alert"("runId", "t");
