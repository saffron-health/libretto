import type * as React from "react";
import { SafeMdxRenderer } from "safe-mdx";
import { AppLink } from "../routing";
import { Button } from "../components/Button";
import { Footer } from "../components/Footer";
import { Navbar } from "../components/Navbar";
import { Text } from "../components/Text";
import { BLOG_POSTS, getBlogPost, type BlogPost } from "./posts";

const BLOG_LOGO = String.raw`
 ██████╗ ██╗      ██████╗  ██████╗
 ██╔══██╗██║     ██╔═══██╗██╔════╝
 ██████╔╝██║     ██║   ██║██║  ███╗
 ██╔══██╗██║     ██║   ██║██║   ██║
 ██████╔╝███████╗╚██████╔╝╚██████╔╝
 ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝`;

function formatPostDate(date: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function BlogShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="crt-page flex min-h-screen flex-col bg-bg text-ink">
      <Navbar />
      <main className="section-rails relative mx-auto mt-16 flex w-full max-w-[1100px] flex-1 flex-col px-8">
        <div className="flex-1">{children}</div>
        <Footer />
      </main>
    </div>
  );
}

function BlogPostPreview({ post }: { post: BlogPost }) {
  return (
    <article className="border-t border-rule py-8">
      <AppLink
        href={`/blog/${post.slug}`}
        className="group block no-underline"
        data-fathom-event="Blog post click"
      >
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Text as="time" size="xs" className="text-muted/70">
            {formatPostDate(post.publishedAt)}
          </Text>
          <Text size="xs" className="text-muted/50">
            {post.readingTime}
          </Text>
        </div>
        <Text
          as="h2"
          size="3xl"
          style="serif"
          className="mb-4 max-w-[760px] font-[300] leading-tight text-ink transition-colors group-hover:text-accent-bright"
        >
          {post.title}
        </Text>
        <Text as="p" size="md" className="max-w-[660px] leading-relaxed text-muted">
          {post.description}
        </Text>
      </AppLink>
    </article>
  );
}

export function BlogIndexPage() {
  return (
    <BlogShell>
      <section className="mx-auto max-w-[800px] pt-8">
        <div
          className="mb-10 flex overflow-hidden"
          style={{
            filter:
              "drop-shadow(0 0 6px color-mix(in oklch, var(--color-amber-bright) 28%, transparent)) drop-shadow(0 0 18px color-mix(in oklch, var(--color-amber-bright) 14%, transparent))",
          }}
        >
          <pre
            aria-label="Blog"
            className="whitespace-pre font-mono text-[6px] leading-none tracking-[0] text-amber sm:text-[8.25px] md:text-[10.5px] lg:text-[12px]"
            style={{
              textShadow:
                "0 0 4px color-mix(in oklch, var(--color-amber-bright) 28%, transparent), 0 0 12px color-mix(in oklch, var(--color-amber-bright) 14%, transparent)",
            }}
          >
            {BLOG_LOGO}
          </pre>
        </div>
        {BLOG_POSTS.map((post) => (
          <BlogPostPreview key={post.slug} post={post} />
        ))}
      </section>
    </BlogShell>
  );
}

const markdownComponents = {
  h2({ children }: { children?: React.ReactNode }) {
    return (
      <Text
        as="h2"
        size="3xl"
        style="serif"
        className="mt-14 mb-6 font-[300] leading-tight text-ink first:mt-0"
      >
        {children}
      </Text>
    );
  },
  p({ children }: { children?: React.ReactNode }) {
    return <p className="mb-6 leading-[1.85] text-muted">{children}</p>;
  },
  ol({ children }: { children?: React.ReactNode }) {
    return (
      <ol className="mb-8 list-decimal space-y-4 pl-6 leading-[1.75] text-muted marker:text-accent">
        {children}
      </ol>
    );
  },
  ul({ children }: { children?: React.ReactNode }) {
    return (
      <ul className="mb-8 list-disc space-y-4 pl-6 leading-[1.75] text-muted marker:text-accent">
        {children}
      </ul>
    );
  },
  li({ children }: { children?: React.ReactNode }) {
    return <li className="pl-2">{children}</li>;
  },
  strong({ children }: { children?: React.ReactNode }) {
    return <strong className="font-semibold text-ink">{children}</strong>;
  },
  em({ children }: { children?: React.ReactNode }) {
    return <em className="text-ink">{children}</em>;
  },
  a({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    const isExternal = typeof href === "string" && /^https?:\/\//.test(href);

    return (
      <AppLink
        href={href ?? "#"}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        className="text-accent-bright underline decoration-accent/40 underline-offset-4 transition-colors hover:text-ink"
      >
        {children}
      </AppLink>
    );
  },
};

export function BlogPostPage({ slug }: { slug: string }) {
  const post = getBlogPost(slug);

  if (!post) {
    return (
      <BlogShell>
        <section className="mx-auto max-w-[760px] pt-8 pb-20">
          <Text as="p" size="xs" className="mb-5 uppercase tracking-[0.16em] text-accent">
            404
          </Text>
          <Text
            as="h1"
            size="5xl"
            style="serif"
            className="crt-glow mb-6 font-[300] leading-none text-ink"
          >
            Post not found.
          </Text>
          <Button href="/blog" variant="secondary" data-fathom-event="Blog back click">
            Back to blog
          </Button>
        </section>
      </BlogShell>
    );
  }

  return (
    <BlogShell>
      <article className="mx-auto max-w-[760px] pt-8 pb-20">
        <AppLink
          href="/blog"
          className="mb-10 inline-block text-sm text-muted/70 no-underline transition-colors hover:text-accent-bright"
          data-fathom-event="Blog back click"
        >
          Back to blog
        </AppLink>
        <div className="mb-10 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Text as="time" size="xs" className="text-muted/70">
            {formatPostDate(post.publishedAt)}
          </Text>
          <Text size="xs" className="text-muted/50">
            {post.readingTime}
          </Text>
        </div>
        <div className="blog-markdown text-[1rem]">
          <SafeMdxRenderer
            markdown={post.markdown}
            mdast={post.mdast}
            components={markdownComponents}
          />
        </div>
      </article>
    </BlogShell>
  );
}
