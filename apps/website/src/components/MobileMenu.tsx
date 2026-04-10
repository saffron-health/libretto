import { useState } from "react";
import {
  MenuTrigger,
  Menu,
  MenuItem,
  Popover,
  Button as AriaButton,
} from "react-aria-components";
import { motion } from "motion/react";
import { GitHubStarIcon } from "../icons";
import { DISCUSSIONS_URL, RELEASES_URL, REPO_URL } from "../site";
import { CrossfadeIcon } from "./CrossfadeIcon";

type AnimationState = "unmounted" | "hidden" | "visible";

function HamburgerIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      <line
        x1={3}
        y1={5}
        x2={15}
        y2={5}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <line
        x1={3}
        y1={9}
        x2={15}
        y2={9}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <line
        x1={3}
        y1={13}
        x2={15}
        y2={13}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      <line
        x1={4}
        y1={4}
        x2={14}
        y2={14}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <line
        x1={14}
        y1={4}
        x2={4}
        y2={14}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

const itemClass =
  "flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-ink outline-none rounded-lg cursor-pointer data-[focused]:bg-ink/[0.06] data-[pressed]:bg-ink/[0.08]";

export function MobileMenu({ stars }: { stars: string | null }) {
  const [animation, setAnimation] = useState<AnimationState>("unmounted");

  return (
    <MenuTrigger
      onOpenChange={(isOpen) => setAnimation(isOpen ? "visible" : "hidden")}
    >
      <AriaButton
        aria-label="Menu"
        className="relative flex size-9 items-center justify-center rounded-lg text-ink outline-none hover:bg-ink/[0.06] focus-visible:ring-2 focus-visible:ring-ink/20"
      >
        <CrossfadeIcon
          activeKey={animation === "visible" ? "close" : "hamburger"}
          className="absolute inset-0"
        >
          {animation === "visible" ? <CloseIcon /> : <HamburgerIcon />}
        </CrossfadeIcon>
      </AriaButton>
      <Popover
        placement="bottom end"
        offset={8}
        className="outline-none"
        isExiting={animation === "hidden"}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={
            animation === "visible"
              ? { opacity: 1, scale: 1, y: 0 }
              : { opacity: 0, scale: 0.95, y: -4 }
          }
          onAnimationComplete={() => {
            if (animation === "hidden") {
              setAnimation("unmounted");
            }
          }}
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          className="min-w-[180px] origin-top-right rounded-xl border border-ink/10 bg-cream p-1.5 shadow-lg shadow-ink/[0.08]"
        >
          <Menu className="outline-none">
            <MenuItem
              href={DISCUSSIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={itemClass}
            >
              Forum
            </MenuItem>
            <MenuItem
              href={RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={itemClass}
            >
              Changelog
            </MenuItem>
            <MenuItem
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={itemClass}
            >
              <GitHubStarIcon width={15} height={15} />
              GitHub{stars !== null && ` (${stars})`}
            </MenuItem>
          </Menu>
        </motion.div>
      </Popover>
    </MenuTrigger>
  );
}
