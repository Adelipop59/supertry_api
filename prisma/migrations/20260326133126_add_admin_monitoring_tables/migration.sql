-- CreateTable
CREATE TABLE "system_snapshots" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuPercent" INTEGER NOT NULL,
    "memoryPercent" INTEGER NOT NULL,
    "memoryUsedMb" DOUBLE PRECISION NOT NULL,
    "diskPercent" INTEGER,
    "diskUsedGb" DOUBLE PRECISION,
    "networkRxMb" DOUBLE PRECISION,
    "networkTxMb" DOUBLE PRECISION,
    "processHeapPercent" INTEGER NOT NULL,
    "processRssMb" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "system_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_metrics" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "total_duration_ms" INTEGER NOT NULL DEFAULT 0,
    "min_duration_ms" INTEGER NOT NULL DEFAULT 0,
    "max_duration_ms" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "api_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_snapshots_timestamp_idx" ON "system_snapshots"("timestamp");

-- CreateIndex
CREATE INDEX "api_metrics_timestamp_idx" ON "api_metrics"("timestamp");

-- CreateIndex
CREATE INDEX "api_metrics_method_route_idx" ON "api_metrics"("method", "route");

-- CreateIndex
CREATE UNIQUE INDEX "api_metrics_timestamp_method_route_key" ON "api_metrics"("timestamp", "method", "route");
