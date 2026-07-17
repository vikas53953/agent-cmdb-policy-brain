// Honest stage placeholder (U4). The tab routes exist so the bottom tabs are real,
// working navigation — but the feature content for Search, DJ, and Library lands in
// later units. Rather than fake those screens, each renders this panel: a plain,
// non-technical note that the feature is on the way and which stage brings it. No
// interactive controls, so nothing here pretends to be a feature (R17). Owning units
// replace these pages with the real screen.

export default function StagePlaceholder({
  stage,
  title,
  body,
}: {
  stage: string;
  title: string;
  body: string;
}) {
  return (
    <div className="stage">
      <span className="stage-badge">{stage}</span>
      <h1 className="stage-title">{title}</h1>
      <p className="stage-body">{body}</p>
    </div>
  );
}
