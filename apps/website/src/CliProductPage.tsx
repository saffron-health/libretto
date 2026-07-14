import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { FeatureRows } from "./components/FeatureRows";
import { BattleTestedBanner } from "./components/BattleTestedBanner";
import { Benchmarks } from "./components/Benchmarks";
import { MaintainingFeatures } from "./components/MaintainingFeatures";
import { AutofixPR } from "./components/AutofixPR";
import { CloudProviders } from "./components/CloudProviders";
import { FAQ } from "./components/FAQ";
import { CTA } from "./components/CTA";
import { SectionDivider } from "./components/SectionDivider.js";

export function CliProductPage() {
  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <div className="section-rails relative mx-auto max-w-[1100px]">
        <FeatureRows />
        <SectionDivider />
        <Benchmarks />
        <SectionDivider />
        <BattleTestedBanner />
        <SectionDivider />
        <MaintainingFeatures />
        <SectionDivider />
        <AutofixPR />
        <SectionDivider />
        <CloudProviders />
        <SectionDivider />
        <FAQ />
        <SectionDivider />
        <CTA />
        <Footer />
      </div>
    </div>
  );
}
