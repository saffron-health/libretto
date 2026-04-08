import { Text } from "./Text";
import { DiscordIcon, GitHubIcon, LinkedInIcon } from "../icons";
import { DISCORD_URL, REPO_URL } from "../site";

export function Footer() {
  return (
    <footer className="px-8 pb-8 pt-20">
      <div className="mx-auto mb-12 h-px w-[160px] bg-ink/10" />
      <div className="mx-auto flex max-w-[800px] items-center justify-between">
        <Text size="xs" className="text-muted/50">
          © {new Date().getFullYear()} Saffron Health
        </Text>
        <div className="flex items-center gap-3">
          <a
            href="https://www.linkedin.com/company/saffron-health"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Saffron Health on LinkedIn"
            className="text-muted/50 transition-colors hover:text-muted"
          >
            <LinkedInIcon width={14} height={14} />
          </a>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Libretto on Discord"
            className="text-muted/50 transition-colors hover:text-muted"
          >
            <DiscordIcon width={14} height={14} />
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Libretto on GitHub"
            className="text-muted/50 transition-colors hover:text-muted"
          >
            <GitHubIcon width={14} height={14} />
          </a>
        </div>
      </div>
    </footer>
  );
}
