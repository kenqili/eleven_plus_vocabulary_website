import { currentUser } from "@/lib/server/auth";
import { missionFor } from "@/lib/server/mission";
import { boundary, json } from "@/lib/server/http";
export async function GET(request: Request) {
  return boundary(async () => {
    const user = await currentUser(request);
    return json({ mission: user ? await missionFor(user.id) : null });
  });
}
