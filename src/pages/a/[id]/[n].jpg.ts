import type { APIRoute, GetStaticPaths } from "astro";
import { articles, r2 } from "../../../lib/archive";

// The bucket is private, so each photo is copied out of R2 into the build.
export const getStaticPaths = (async () =>
  (await articles()).flatMap((row) =>
    row.photos.map((key, index) => ({
      params: { id: row.id, n: String(index + 1) },
      props: { key },
    }))
  )) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const archive = r2();
  if (archive === null) {
    throw new Error("R2 is not configured; cannot copy article photos.");
  }
  const response = await archive.client.fetch(archive.object(props.key));
  if (!response.ok) {
    throw new Error(`R2 ${response.status} for ${props.key}`);
  }
  return new Response(await response.arrayBuffer(), {
    headers: { "Content-Type": "image/jpeg" },
  });
};
