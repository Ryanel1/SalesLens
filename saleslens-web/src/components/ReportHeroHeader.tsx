import Image from "next/image";

export type ReportHeroHeaderProps = {
  accountName: string;
  periodPillLabel: string;
  scoreAriaLabel: string;
  scoreTone: "positive" | "negative" | "neutral" | "pending" | string;
  currentSalesLabel: string;
  currentSalesValue: string;
  currentSalesDetail: string;
  comparisonLabel: string;
  comparisonValue: string;
  comparisonDetail?: string;
  priorDetail: string;
  unitsLabel: string;
  unitsValue: string;
  unitsDetail: string;
};

export function ReportHeroHeader({
  accountName,
  comparisonDetail,
  comparisonLabel,
  comparisonValue,
  currentSalesDetail,
  currentSalesLabel,
  currentSalesValue,
  periodPillLabel,
  priorDetail,
  scoreAriaLabel,
  scoreTone,
  unitsDetail,
  unitsLabel,
  unitsValue,
}: ReportHeroHeaderProps) {
  const accountLogo = accountTeamLogo(accountName);

  return (
    <header className="dashboardHeader dashboardTopSection">
      <div className="dashboardHeroIntro">
        <h2 className="dashboardAccountTitle">
          <span>{accountName}</span>
          {accountLogo ? (
            <Image
              className="accountTeamLogo"
              src={accountLogo.src}
              alt=""
              aria-hidden="true"
              width={accountLogo.width}
              height={accountLogo.height}
            />
          ) : null}
        </h2>
        <div className="dashboardHeroKicker">
          <span>{periodPillLabel}</span>
        </div>
      </div>

      <aside className="dashboardHeroContact" aria-label="Sales representative contact">
        <strong>Ryan Lester</strong>
        <a href="tel:+15026897374">Phone: (502) 689-7374</a>
        <a href="mailto:ryanlestersells@gmail.com">Email: ryanlestersells@gmail.com</a>
        <a href="https://www.lestersales.net" target="_blank" rel="noreferrer">Website: www.lestersales.net</a>
      </aside>

      <div className={`dashboardScoreboard ${scoreTone}`} aria-label={scoreAriaLabel}>
        <div className="scoreboardPrimary">
          <span>{currentSalesLabel}</span>
          <strong>{currentSalesValue}</strong>
          <em>{currentSalesDetail}</em>
        </div>
        <div>
          <span>{comparisonLabel}</span>
          <strong className="scoreDeltaValue">
            <span>{comparisonValue}</span>
            {comparisonDetail ? <span>{comparisonDetail}</span> : null}
          </strong>
          <em>{priorDetail}</em>
        </div>
        <div>
          <span>{unitsLabel}</span>
          <strong>{unitsValue}</strong>
          <em>{unitsDetail}</em>
        </div>
      </div>
    </header>
  );
}

export function accountThemeClass(name?: string | null) {
  const normalized = (name ?? "").toLowerCase();
  if (normalized.includes("rebel")) return "accountThemeRebelRags";
  if (normalized.includes("volshop") || normalized.includes("vol shop")) return "accountThemeVolshop";
  return "accountThemeDefault";
}

function accountTeamLogo(name?: string | null) {
  const normalized = (name ?? "").toLowerCase();
  if (normalized.includes("rebel")) return { src: "/images/account-logos/ole-miss.png", width: 405, height: 369 };
  if (normalized.includes("volshop") || normalized.includes("vol shop")) return { src: "/images/account-logos/tennessee.png", width: 951, height: 951 };
  return null;
}
