import { redirect } from "next/navigation";

// The ten separate guides became one page. The old index URL keeps working.
export default function GuidesIndex() {
  redirect("/info");
}
