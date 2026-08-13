/**
 * The walk — the surveyor's capture screen, and the one that decides adoption.
 *
 * If this screen is slow or asks irrelevant questions, nothing else in the
 * module matters: a customer once reverted an entire CMMS over exactly this.
 * Two design consequences are visible here and both are contract-level, not
 * polish:
 *
 * 1. **One read.** The whole screen — sections, questions, entries, answers,
 *    observations, nodes — arrives from a single `walk` call. Seven result sets
 *    fetched separately would be seven times ~194ms of fixed bridge overhead
 *    before anything renders.
 * 2. **One write per room.** `capture` takes arrays, so a room with five
 *    answers and a condition score is ONE round trip. Sent one answer at a time
 *    it is ~1.1s each, and the surveyor gives up on the second floor.
 *
 * ⚠ SEAM: makes NO request — the `survey` function is not built, so there is no
 * snapshot to walk. The capture controls themselves already exist, in
 * `templates/components/FormRender.tsx`, and the template preview drives them
 * today; this page will render them from that same file rather than growing a
 * second copy, so a preview stays evidence of what the surveyor actually sees.
 */

import { useNavigate, useParams } from "react-router-dom";
import { ClipboardList, Eye } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { Card, Stack } from "../../../ui/Card";
import { Empty } from "../../../ui/States";
import { Button } from "@/components/ui/button";

export function SurveyWalk() {
  const navigate = useNavigate();
  const { id } = useParams();

  return (
    <PageShell
      title="Walk"
      subtitle={id ? `Survey ${id} — capture` : "Capture"}
      actions={
        <Button variant="outline" onClick={() => navigate(`/surveys/${id ?? ""}`)}>
          Back to the survey
        </Button>
      }
    >
      <Stack>
        <Card pad={false}>
          <Empty
            title="Nothing to walk yet"
            body="The walk renders the question set that was snapshotted onto this survey when it was scheduled — so a template edited afterwards never changes what a surveyor in the field is answering."
            action={
              <Button variant="outline" onClick={() => navigate("/templates/new")}>
                <Eye className="size-4" />
                Preview a template instead
              </Button>
            }
          />
        </Card>

        <Card title="What this screen will do">
          <ul className="text-muted-foreground flex list-disc flex-col gap-2 pl-4 text-sm">
            <li>
              Add only the rooms actually entered — “+ Add another Room” — name each one, answer its
              questions, score its condition. No pre-seeded grid of forty spaces.
            </li>
            <li>
              Score condition 1–5 with the word always shown beside the number, never the number
              alone.
            </li>
            <li>
              Verdict the nodes that came from the tender documents: verified, changed, not found,
              not visited. A note is required for anything but verified.
            </li>
            <li>Capture a whole room in one request, so the screen stays usable on site.</li>
          </ul>
        </Card>

        <div>
          <Button variant="ghost" onClick={() => navigate("/surveys")}>
            <ClipboardList className="size-4" />
            All surveys
          </Button>
        </div>
      </Stack>
    </PageShell>
  );
}
