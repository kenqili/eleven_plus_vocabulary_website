import {
  saveReadingBookmark,
  saveReadingPreference,
} from "@/lib/server/reading-position";
import { getStory } from "@/lib/server/stories";
import { currentUser, requireUser, rateLimit } from "@/lib/server/auth";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
import {
  completeStory,
  readingCheckpoint,
  startStory,
  storyCatalog,
  storyDetail,
} from "@/lib/server/stories";

export async function GET(request: Request) {
  return boundary(async () => {
    const user = await currentUser(request);
    const id = new URL(request.url).searchParams.get("id");
    return json(
      id ? await storyDetail(id, user?.id) : await storyCatalog(user?.id),
    );
  });
}
export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request),
      input = await body(request);
    if (input.action === "level") {
      await rateLimit(`reading-position:${user.id}`, 600);
      return json(await saveReadingPreference(user.id, input));
    }
    if (
      typeof input.storyId !== "string" ||
      !/^level-[0-5]-(0[1-9]|10)$/.test(input.storyId)
    )
      throw new HttpError(400, "Choose a story from Word Adventures.");
    await rateLimit(`stories:${user.id}`, 600);
    if (input.action === "bookmark")
      return json(
        await saveReadingBookmark(
          user.id,
          await getStory(input.storyId),
          input,
        ),
      );
    if (input.action === "start")
      return json(await startStory(user.id, input.storyId, input.owner));
    if (input.action === "time")
      return json(await readingCheckpoint(user.id, input.storyId, input));
    if (input.action === "complete") {
      await rateLimit(`story-answer:${user.id}`, 60);
      return json(await completeStory(user.id, input.storyId, input.answer));
    }
    throw new HttpError(400, "Unknown reading action.");
  });
}
