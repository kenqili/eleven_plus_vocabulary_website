import type { Metadata } from "next";
import AdminPage from "@/components/minewords/admin";

export const metadata: Metadata = { title: "Administrator - MineWords" };

/**
 * Issues codes, so it is not linked from the header or the account page: a
 * parent should not have to navigate to a page to find out it is not for them.
 * The route is still reachable by anyone who types it, which is why every answer
 * from `/api/admin` goes through `requireAdmin` - this page is a view, not a
 * gate.
 */
export default function Admin() {
  return <AdminPage />;
}