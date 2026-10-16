import assert from "node:assert/strict";
import test from "node:test";
import { nextBookmarkState, orderBookmarkedArticles } from "./bookmarks";

test("a toggle saves what is unsaved and removes what is saved", () => {
  assert.deepEqual(nextBookmarkState(false), { bookmarked: true });
  assert.deepEqual(nextBookmarkState(true), { bookmarked: false });
  // Both presses a reader can send go through the same rule, so two of them cancel out.
  assert.deepEqual(nextBookmarkState(nextBookmarkState(false).bookmarked), { bookmarked: false });
});

test("the list reads in bookmark order, newest save first, not in query order", () => {
  const articles = [
    { id: "a", slug: "report-a", title: "A" },
    { id: "b", slug: "report-b", title: "B" },
    { id: "c", slug: "report-c", title: "C" },
  ];
  const bookmarks = [
    { articleId: "c", createdAt: new Date("2026-10-03T10:00:00Z") },
    { articleId: "a", createdAt: new Date("2026-10-01T10:00:00Z") },
    { articleId: "b", createdAt: new Date("2026-10-02T10:00:00Z") },
  ];
  const ordered = orderBookmarkedArticles(articles, bookmarks);
  assert.deepEqual(ordered.map((row) => row.id), ["c", "a", "b"]);
  // The article fields survive the reorder, and each row carries the save that produced it.
  assert.equal(ordered[0].title, "C");
  assert.equal(ordered[0].slug, "report-c");
  assert.deepEqual(ordered.map((row) => row.bookmarkedAt), bookmarks.map((bookmark) => bookmark.createdAt));
});

test("a report the gate withholds never reaches the list while its bookmark remains", () => {
  // The article query already asks the publication gate; this is the second half of the
  // promise — a bookmark with no fetched article drops out instead of rendering a dead link.
  const bookmarks = [
    { articleId: "withdrawn", createdAt: new Date("2026-10-03T10:00:00Z") },
    { articleId: "still-public", createdAt: new Date("2026-10-02T10:00:00Z") },
  ];
  const fetched = [{ id: "still-public", title: "Still public" }];
  const ordered = orderBookmarkedArticles(fetched, bookmarks);
  assert.deepEqual(ordered.map((row) => row.id), ["still-public"]);
});

test("an article nobody bookmarked cannot ride along, and no bookmarks mean no rows", () => {
  assert.deepEqual(orderBookmarkedArticles([{ id: "unrelated" }], []), []);
  assert.deepEqual(
    orderBookmarkedArticles(
      [{ id: "unrelated" }, { id: "other" }],
      [{ articleId: "saved", createdAt: new Date("2026-10-01T00:00:00Z") }],
    ),
    [],
  );
});
