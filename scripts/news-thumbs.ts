import Jimp from "jimp";
import { prisma } from "../src/lib/db";

/**
 * Backfill list thumbnails for news images stored before the thumbnail column existed.
 * The image route falls back to the full file, so this is purely bandwidth.
 */
async function main() {
  const rows = await prisma.newsImage.findMany({
    where: { thumbMimeType: null },
    select: { id: true, data: true },
  });
  let done = 0;
  for (const row of rows) {
    try {
      const image = await Jimp.read(Buffer.from(row.data));
      const width = image.bitmap.width;
      const height = image.bitmap.height;
      const thumb = image.clone();
      if (thumb.bitmap.width > 360) thumb.resize(360, Jimp.AUTO);
      const thumbData = await thumb.quality(82).getBufferAsync(Jimp.MIME_JPEG);
      await prisma.newsImage.update({
        where: { id: row.id },
        data: {
          width, height,
          thumbData: Buffer.from(thumbData),
          thumbMimeType: "image/jpeg",
          thumbWidth: thumb.bitmap.width,
          thumbHeight: thumb.bitmap.height,
        },
      });
      done++;
    } catch (error) {
      console.warn(JSON.stringify({ event: "news.thumb.failed", id: row.id, error: String(error).slice(0, 200) }));
    }
  }
  console.log(JSON.stringify({ event: "news.thumb.done", scanned: rows.length, updated: done }));
}

main().finally(() => prisma.$disconnect());
