import { requireUser } from "@/lib/server/auth";
import { boundary, HttpError, json } from "@/lib/server/http";
import { learningCalendar } from "@/lib/server/calendar";
import { validMonth } from "@/lib/challenge/calendar";
import { localDay } from "@/lib/challenge/rewards";
export async function GET(request: Request) {
  return boundary(async () => {
    const user = await requireUser(request);
    const currentMonth = localDay(Date.now()).slice(0, 7);
    const month =
      new URL(request.url).searchParams.get("month") ?? currentMonth;
    if (!validMonth(month) || month > currentMonth)
      throw new HttpError(
        400,
        "Choose a month between January 2000 and this month.",
      );
    return json(await learningCalendar(user.id, month));
  });
}
