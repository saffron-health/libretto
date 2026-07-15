import { Button } from "./Button.js";
import { InstallSnippet } from "./InstallSnippet.js";
import { SectionIntro } from "./SectionIntro.js";
import { SiteSection } from "./SiteSection.js";

export function CTA() {
  return (
    <SiteSection innerClassName="text-center">
      <SectionIntro copyClassName="mb-8" title="Ready to get started?">
        Read the docs to set up Libretto and build your first integration in
        minutes.
      </SectionIntro>
      <div className="flex flex-col items-center gap-3">
        <InstallSnippet fathomEvent="CTA copy prompt click" />
        <div className="flex items-center gap-2">
          <span className="text-sm text-faint">or</span>
          <Button
            href="https://cal.com/team/libretto/demo"
            variant="secondary"
            data-fathom-event="CTA demo click"
          >
            book a demo
          </Button>
        </div>
      </div>
    </SiteSection>
  );
}
