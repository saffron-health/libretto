import { Button } from "./Button.js";
import { SectionIntro } from "./SectionIntro.js";
import { SiteSection } from "./SiteSection.js";

export function CTA() {
  return (
    <SiteSection innerClassName="text-center">
      <SectionIntro copyClassName="mb-8" title="Ready to get started?">
        Hand off a task in Chrome, build an automation in your codebase, or give
        your agent access to the web.
      </SectionIntro>
      <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
        <Button href="/chrome-extension" data-fathom-event="CTA Chrome click">
          Automate with Chrome
        </Button>
        <Button
          href="/docs/get-started/quickstart"
          variant="secondary"
          data-fathom-event="CTA docs click"
        >
          Explore developer tools
        </Button>
      </div>
    </SiteSection>
  );
}
