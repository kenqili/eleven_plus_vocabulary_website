import StoryReader from "@/components/minewords/story-reader";
export const metadata = { title: "Read a Word Adventure | MineWords" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StoryReader id={id} />;
}
