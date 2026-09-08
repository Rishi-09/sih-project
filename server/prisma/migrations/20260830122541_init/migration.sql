-- CreateTable
CREATE TABLE `Engine` (
    `id` VARCHAR(191) NOT NULL,
    `tail` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    UNIQUE INDEX `Engine_tail_key`(`tail`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Run` (
    `id` VARCHAR(191) NOT NULL,
    `engineId` VARCHAR(191) NOT NULL,
    `scenario` VARCHAR(191) NOT NULL,
    `seed` INTEGER NOT NULL,
    `contractVersion` VARCHAR(191) NOT NULL,
    `missionProfile` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    INDEX `Run_engineId_startedAt_idx`(`engineId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Frame` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` VARCHAR(191) NOT NULL,
    `t` INTEGER NOT NULL,
    `ts` DATETIME(3) NOT NULL,
    `phase` VARCHAR(191) NOT NULL,
    `rpm` DOUBLE NOT NULL,
    `mapKpa` DOUBLE NOT NULL,
    `egt1` DOUBLE NOT NULL,
    `egt2` DOUBLE NOT NULL,
    `egt3` DOUBLE NOT NULL,
    `egt4` DOUBLE NOT NULL,
    `cht1` DOUBLE NOT NULL,
    `cht2` DOUBLE NOT NULL,
    `cht3` DOUBLE NOT NULL,
    `cht4` DOUBLE NOT NULL,
    `oilPressBar` DOUBLE NOT NULL,
    `oilTempC` DOUBLE NOT NULL,
    `coolantTempC` DOUBLE NOT NULL,
    `fuelFlowLph` DOUBLE NOT NULL,
    `fuelPressBar` DOUBLE NOT NULL,
    `injTimingDeg` DOUBLE NOT NULL,
    `vibRmsG` DOUBLE NOT NULL,
    `busVoltageV` DOUBLE NOT NULL,
    `altCurrentA` DOUBLE NOT NULL,
    `context` TEXT NOT NULL,
    `residualZ` TEXT NOT NULL,
    `health` TEXT NOT NULL,
    `ehi` DOUBLE NULL,
    `faultLabel` VARCHAR(191) NULL,
    `confidence` DOUBLE NULL,
    `rulSec` INTEGER NULL,
    `pSuccess` DOUBLE NULL,
    `sensorFaultChannel` VARCHAR(191) NULL,
    `sensorFaultMode` VARCHAR(191) NULL,
    INDEX `Frame_runId_t_idx`(`runId`, `t`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Alert` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `t` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `clearedAtT` INTEGER NULL,
    `ackedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `Alert_runId_t_idx`(`runId`, `t`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Report` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `contentMd` TEXT NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `Report_runId_idx`(`runId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatMessage` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `ChatMessage_runId_idx`(`runId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModelVersion` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `metrics` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
