import { CheckCircle2, FileText, ListChecks } from "lucide-react";
import type { ReplBriefingReport } from "@interview/shared";

type Props = {
  briefing: ReplBriefingReport;
};

export function AggregateBriefingView({ briefing }: Props) {
  return (
    <section className="border border-cyan/40 bg-elevated p-3">
      <div className="flex items-start gap-2">
        <FileText size={16} className="mt-0.5 shrink-0 text-cyan" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-body font-semibold text-primary">
              {briefing.title}
            </h3>
            <span className="mono text-caption text-dim">
              {briefing.provider}
            </span>
          </div>
          <p className="mt-1 text-body text-primary">{briefing.summary}</p>
        </div>
      </div>

      {briefing.sections.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {briefing.sections.map((section, index) => (
            <article
              key={`${section.title}-${index}`}
              className="border border-hairline bg-panel/50 p-2"
            >
              <div className="mb-1 flex items-center gap-2">
                <CheckCircle2 size={13} className="text-cold" />
                <h4 className="text-caption font-semibold text-primary">
                  {section.title}
                </h4>
              </div>
              {section.body && (
                <p className="text-caption text-muted">{section.body}</p>
              )}
              {section.bullets.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {section.bullets.map((bullet, bulletIndex) => (
                    <li
                      key={`${section.title}-${bulletIndex}`}
                      className="text-caption text-primary"
                    >
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}

      {briefing.nextActions.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-2">
          <div className="mb-1 flex items-center gap-2">
            <ListChecks size={13} className="text-cyan" />
            <span className="mono text-caption text-cyan">next actions</span>
          </div>
          <div className="flex flex-col gap-1">
            {briefing.nextActions.map((action, index) => (
              <div key={index} className="text-caption text-primary">
                {action}
              </div>
            ))}
          </div>
        </div>
      )}

      {briefing.evidence.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-2">
          <div className="mono mb-1 text-caption text-dim">
            evidence · {briefing.evidence.length}
          </div>
          <div className="grid gap-1 md:grid-cols-2">
            {briefing.evidence.slice(0, 8).map((item) => (
              <div
                key={`${item.source}-${item.followupId ?? "parent"}-${item.id}`}
                className="mono min-w-0 text-caption text-muted"
              >
                <span className="text-primary">#{item.id}</span>{" "}
                <span>{item.title}</span>
                {item.cortex && <span className="text-dim"> [{item.cortex}]</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
