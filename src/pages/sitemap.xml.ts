import type { APIRoute } from "astro";
import { articles, lessons, series } from "../lib/archive";
import { articlePath, lessonPath, seriesPath } from "../lib/paths";
import { SITE_URL } from "../lib/seo";

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

export const GET: APIRoute = async () => {
  const [articleRows, seriesRows, lessonRows] = await Promise.all([
    articles(),
    series(),
    lessons(),
  ]);
  const entries: { lastmod?: string; path: string }[] = [
    ...["/", "/a/", "/p/", "/b/", "/contact/"].map((path) => ({ path })),
    ...articleRows.map((row) => ({
      lastmod: new Date(row.date).toISOString().slice(0, 10),
      path: articlePath(row.id),
    })),
    ...seriesRows.map((row) => ({ path: seriesPath(row.name) })),
    ...lessonRows.map((row) => ({ path: lessonPath(row.id) })),
  ];
  // ponytail: one file holds 50,000 URLs; split into a sitemap index past that.
  const urls = entries
    .map(
      ({ lastmod, path }) =>
        `<url><loc>${xml(`${SITE_URL}${path}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`
    )
    .join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  );
};
