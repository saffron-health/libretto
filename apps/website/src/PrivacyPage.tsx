import { Footer } from "./components/Footer";
import { Navbar } from "./components/Navbar";
import { Text } from "./components/Text";

const sectionClass = "space-y-3";
const listClass = "list-disc space-y-2 pl-5 text-muted";

export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-base text-ink">
      <Navbar />
      <main className="mx-auto max-w-[800px] px-6 py-16 md:px-8 md:py-24">
        <Text
          as="h1"
          size="5xl"
          style="serif"
          className="tracking-[-0.04em]"
          htmlStyle={{ fontWeight: 300, lineHeight: 1 }}
        >
          Privacy policy
        </Text>
        <Text as="p" size="sm" className="mt-4 text-faint">
          Last updated July 29, 2026
        </Text>

        <div className="mt-12 space-y-10 leading-relaxed">
          <section className={sectionClass}>
            <Text as="h2" size="xl" className="text-accent-bright">
              Scope
            </Text>
            <Text as="p" className="text-muted">
              This policy explains how Libretto handles data through libretto.sh, Libretto Cloud,
              and the Libretto Chrome extension.
            </Text>
          </section>

          <section className={sectionClass}>
            <Text as="h2" size="xl" className="text-accent-bright">
              Data we handle
            </Text>
            <ul className={listClass}>
              <li>Account details, such as your email address.</li>
              <li>
                Authentication data, including Libretto sessions and credentials you choose to save
                for an automation.
              </li>
              <li>
                Automation data, such as prompts, workflows, schedules, run activity, and results.
              </li>
              <li>
                Content and interactions from browser tabs involved in a recording or local task
                that you start. This may include URLs, page content, screenshots, form values, and
                browser actions needed to complete the task.
              </li>
              <li>
                Basic website analytics and service logs used to operate, secure, and improve
                Libretto.
              </li>
            </ul>
            <Text as="p" className="text-muted">
              The Chrome extension does not monitor general browsing outside tasks that you start.
            </Text>
          </section>

          <section className={sectionClass}>
            <Text as="h2" size="xl" className="text-accent-bright">
              How we use data
            </Text>
            <ul className={listClass}>
              <li>Authenticate accounts and provide the Libretto service.</li>
              <li>Create, run, schedule, and troubleshoot automations.</li>
              <li>Send task results and notifications that you request.</li>
              <li>Protect the service and measure its reliability.</li>
            </ul>
            <Text as="p" className="text-muted">
              We do not sell user data or use it for personalized advertising, creditworthiness, or
              lending.
            </Text>
          </section>

          <section className={sectionClass}>
            <Text as="h2" size="xl" className="text-accent-bright">
              Service providers
            </Text>
            <Text as="p" className="text-muted">
              We share data only with service providers needed to run Libretto, such as cloud
              hosting, AI model inference, browser execution, analytics, and email delivery
              providers. They may process data only to provide those services to us. We may also
              disclose data when required by law or needed to protect Libretto and its users.
            </Text>
          </section>

          <section className={sectionClass}>
            <Text as="h2" size="xl" className="text-accent-bright">
              Security and retention
            </Text>
            <Text as="p" className="text-muted">
              We encrypt data in transit. Saved automation credentials are encrypted at rest. We
              keep account and automation data while your account is active or as needed to provide
              the service, meet legal duties, resolve disputes, and protect the service. You can
              delete supported items from the Libretto dashboard or contact us to request deletion
              of your account data.
            </Text>
          </section>

          <section className={sectionClass}>
            <Text as="h2" size="xl" className="text-accent-bright">
              Chrome Web Store Limited Use
            </Text>
            <Text as="p" className="text-muted">
              The use of information received from Google APIs will adhere to the Chrome Web Store
              User Data Policy, including the Limited Use requirements.
            </Text>
          </section>

          <section className={sectionClass}>
            <Text as="h2" size="xl" className="text-accent-bright">
              Contact
            </Text>
            <Text as="p" className="text-muted">
              For privacy questions, email{" "}
              <a className="text-accent-bright underline" href="mailto:team@libretto.sh">
                team@libretto.sh
              </a>
              .
            </Text>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
