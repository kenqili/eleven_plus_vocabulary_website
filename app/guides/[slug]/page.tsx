import { redirect } from "next/navigation";

// The guides became one page rather than ten articles, because a parent
// deciding whether this is worth paying for does not want ten links. Old links
// still work: each article folded into a section on the page, so anything
// shared or bookmarked lands on the right part of it rather than a 404.
const MOVED: Record<string, string> = {
  "which-11-plus-test": "what-the-11-plus-is",
  "vocabulary-for-the-11-plus": "what-this-app-does",
  "when-to-start-preparing": "when-to-start",
  "how-to-practise-effectively": "what-actually-helps",
  "managing-exam-anxiety": "the-case-against-over-preparation",
  "understanding-english-papers": "the-papers",
  "understanding-maths-papers": "the-papers",
  "verbal-and-non-verbal-reasoning": "the-papers",
  "tailoring-practice-to-your-child": "questions-parents-ask",
  "printable-vocabulary-sheets": "what-this-app-does",
};

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(MOVED).map((slug) => ({ slug }));
}

export default async function MovedGuide({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/info#${MOVED[slug] ?? "what-this-app-does"}`);
}
