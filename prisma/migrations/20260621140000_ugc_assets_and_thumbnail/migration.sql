-- P3.5 : poster/vignette vidéo
ALTER TABLE "ugcs" ADD COLUMN "thumbnail_key" TEXT;

-- P3.3 : médias multiples par UGC (plusieurs photos)
CREATE TABLE "ugc_assets" (
    "id" TEXT NOT NULL,
    "ugc_id" TEXT NOT NULL,
    "content_key" TEXT NOT NULL,
    "mime_type" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ugc_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ugc_assets_ugc_id_idx" ON "ugc_assets"("ugc_id");

ALTER TABLE "ugc_assets"
    ADD CONSTRAINT "ugc_assets_ugc_id_fkey"
    FOREIGN KEY ("ugc_id") REFERENCES "ugcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
