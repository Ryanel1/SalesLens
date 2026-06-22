import { currencyText, numberText } from "@/lib/formatters";

export type StyleSignalStyle = {
  rank: number;
  style: string;
  brand: string;
  sales: number;
  units: number;
  transactions: number;
  colorCount: number;
  artCount: number;
  priorUnits: number;
  priorSales: number;
  priorColorCount: number;
  priorArtCount: number;
};

type SignalTone = "growth" | "risk" | "neutral";

type SignalPanel = {
  title: string;
  description: string;
  tone: SignalTone;
  rows: StyleSignalStyle[];
  emptyText: string;
};

export function StyleSignals({ styles, compareLabel = "LY" }: { styles: StyleSignalStyle[]; compareLabel?: string }) {
  const panels = buildSignalPanels(styles);

  return (
    <div className="styleSignalsGrid">
      {panels.map((panel) => (
        <article className={`styleSignalPanel ${panel.tone}`} key={panel.title}>
          <div className="styleSignalHeader">
            <div>
              <h4>{panel.title}</h4>
              <p>{panel.description}</p>
            </div>
            <span>{panel.rows.length || "-"}</span>
          </div>

          {panel.rows.length ? (
            <div className="styleSignalRows">
              {panel.rows.map((style, index) => (
                <StyleSignalRow compareLabel={compareLabel} index={index} key={`${panel.title}-${style.style}`} style={style} />
              ))}
            </div>
          ) : (
            <p className="styleSignalEmpty">{panel.emptyText}</p>
          )}
        </article>
      ))}
    </div>
  );
}

function buildSignalPanels(styles: StyleSignalStyle[]): SignalPanel[] {
  const usableStyles = styles.filter((style) => style.style && style.style !== "-");
  const growthRows = uniqueByStyle(
    usableStyles
      .filter((style) => styleSalesDelta(style) > 0 || styleUnitDelta(style) > 0)
      .sort((left, right) => styleSalesDelta(right) - styleSalesDelta(left) || styleUnitDelta(right) - styleUnitDelta(left)),
  ).slice(0, 5);
  const declinerRows = uniqueByStyle(
    usableStyles
      .filter((style) => styleSalesDelta(style) < 0 || styleUnitDelta(style) < 0)
      .sort((left, right) => styleSalesDelta(left) - styleSalesDelta(right) || styleUnitDelta(left) - styleUnitDelta(right)),
  ).slice(0, 5);
  const expansionRows = uniqueByStyle(
    usableStyles
      .filter((style) => styleBreadthDelta(style) > 0 || (style.units > 0 && style.priorUnits === 0))
      .sort((left, right) => styleBreadthDelta(right) - styleBreadthDelta(left) || styleSalesDelta(right) - styleSalesDelta(left)),
  ).slice(0, 5);
  const contractionRows = uniqueByStyle(
    usableStyles
      .filter((style) => styleBreadthDelta(style) < 0 || (style.units === 0 && style.priorUnits > 0))
      .sort((left, right) => styleBreadthDelta(left) - styleBreadthDelta(right) || styleSalesDelta(left) - styleSalesDelta(right)),
  ).slice(0, 5);

  return [
    {
      title: "Growth Drivers",
      description: "Styles adding the most dollars or units vs last year.",
      tone: "growth",
      rows: growthRows,
      emptyText: "No clear growth signal for this view yet.",
    },
    {
      title: "Decliners",
      description: "Styles giving back the most dollars or units vs last year.",
      tone: "risk",
      rows: declinerRows,
      emptyText: "No clear decline signal for this view yet.",
    },
    {
      title: "Assortment Expansion",
      description: "Styles with more color or artwork breadth in the market.",
      tone: "neutral",
      rows: expansionRows,
      emptyText: "No expansion signal for this view yet.",
    },
    {
      title: "Assortment Contraction",
      description: "Styles with fewer colors, artworks, or missing current sales.",
      tone: "risk",
      rows: contractionRows,
      emptyText: "No contraction signal for this view yet.",
    },
  ];
}

function StyleSignalRow({
  compareLabel,
  index,
  style,
}: {
  compareLabel: string;
  index: number;
  style: StyleSignalStyle;
}) {
  const unitDelta = styleUnitDelta(style);
  const salesDelta = styleSalesDelta(style);

  return (
    <div className="styleSignalRow">
      <span className="styleSignalRank">{index + 1}</span>
      <div className="styleSignalIdentity">
        <strong>{style.style}</strong>
        <span>{style.brand || "Unclassified"}</span>
      </div>
      <div className="styleSignalMeasure">
        <span>Units</span>
        <strong>
          {numberText(style.units)} vs {numberText(style.priorUnits)} {compareLabel}
        </strong>
      </div>
      <div className="styleSignalBreadth">
        <span>CY {breadthText(style.colorCount, style.artCount)}</span>
        <span>
          {compareLabel} {breadthText(style.priorColorCount, style.priorArtCount)}
        </span>
      </div>
      <div className={`styleSignalDelta ${changeClass(salesDelta)}`}>
        <strong>{currencyText(salesDelta)}</strong>
        <span>
          {unitDelta >= 0 ? "+" : "-"}
          {numberText(Math.abs(unitDelta))} units
        </span>
      </div>
    </div>
  );
}

function uniqueByStyle(styles: StyleSignalStyle[]) {
  const seen = new Set<string>();
  return styles.filter((style) => {
    const key = style.style.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function styleSalesDelta(style: StyleSignalStyle) {
  return style.sales - style.priorSales;
}

function styleUnitDelta(style: StyleSignalStyle) {
  return style.units - style.priorUnits;
}

function styleBreadthDelta(style: StyleSignalStyle) {
  return style.colorCount + style.artCount - style.priorColorCount - style.priorArtCount;
}

function breadthText(colors: number, artworks: number) {
  return `${numberText(colors)} ${colors === 1 ? "Color" : "Colors"} / ${numberText(artworks)} ${artworks === 1 ? "Artwork" : "Artworks"}`;
}

function changeClass(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}
