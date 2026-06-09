import { Children, useEffect } from "react";
import type * as React from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-typescript.js";
import { SafeMdxRenderer } from "safe-mdx";
import { AppLink } from "../routing";
import { Button } from "../components/Button";
import { Footer } from "../components/Footer";
import { Navbar } from "../components/Navbar";
import { Text } from "../components/Text";
import {
  buildBlogPostJsonLd,
  getAbsoluteBlogPostImageUrl,
  getAbsoluteBlogPostUrl,
  serializeJsonLd,
} from "./jsonLd";
import { BLOG_POSTS, getBlogPost } from "./posts";
import type { BlogPost } from "../../scripts/blog-posts.mjs";

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

function BlogPostStructuredData({ post }: { post: BlogPost }) {
  const jsonLd = serializeJsonLd(buildBlogPostJsonLd(post));

  return (
    <script type="application/ld+json">
      {jsonLd}
    </script>
  );
}

function setMetaContent(selector: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    const property = selector.match(/\[property="([^"]+)"\]/)?.[1];
    const name = selector.match(/\[name="([^"]+)"\]/)?.[1];

    if (property) {
      element.setAttribute("property", property);
    }
    if (name) {
      element.setAttribute("name", name);
    }

    document.head.append(element);
  }

  element.content = content;
}

function BlogPostMeta({ post }: { post: BlogPost }) {
  useEffect(() => {
    const title = `${post.title} | Libretto Blog`;
    const url = getAbsoluteBlogPostUrl(post);
    const imageUrl = getAbsoluteBlogPostImageUrl(post);

    document.title = title;
    setMetaContent('meta[name="description"]', post.description);
    setMetaContent('meta[property="og:type"]', "article");
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', post.description);
    setMetaContent('meta[property="og:url"]', url);
    setMetaContent('meta[property="og:image"]', imageUrl);
    setMetaContent('meta[property="og:image:width"]', "1200");
    setMetaContent('meta[property="og:image:height"]', "630");
    setMetaContent('meta[name="twitter:card"]', "summary_large_image");
    setMetaContent('meta[name="twitter:title"]', title);
    setMetaContent('meta[name="twitter:description"]', post.description);
    setMetaContent('meta[name="twitter:image"]', imageUrl);
  }, [post]);

  return null;
}

function getCodeLanguage(className: string | undefined): string | undefined {
  return className?.match(/language-(\w+)/)?.[1];
}

function getCodeText(children: React.ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }

      return "";
    })
    .join("");
}

function Code({ children, className }: React.HTMLAttributes<HTMLElement>) {
  const language = getCodeLanguage(className);
  const code = getCodeText(children);
  const grammar = language ? Prism.languages[language] : undefined;

  if (!language || !grammar) {
    return (
      <code className="rounded border border-rule bg-[#17130d] px-1 py-0.5 font-mono text-[0.95em] text-ink">
        {children}
      </code>
    );
  }

  return (
    <code
      className="font-mono text-sm text-[#e6edf3] [&_.token.boolean]:text-[#79c0ff] [&_.token.builtin]:text-[#ffa657] [&_.token.class-name]:text-[#ffa657] [&_.token.comment]:text-[#8b949e] [&_.token.function]:text-[#d2a8ff] [&_.token.keyword]:text-[#ff7b72] [&_.token.number]:text-[#79c0ff] [&_.token.operator]:text-[#ff7b72] [&_.token.property]:text-[#79c0ff] [&_.token.punctuation]:text-[#c9d1d9] [&_.token.string]:text-[#a5d6ff] [&_.token.variable]:text-[#ffa657]"
      dangerouslySetInnerHTML={{
        __html: Prism.highlight(code, grammar, language),
      }}
    />
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
  h1({ children }: { children?: React.ReactNode }) {
    return (
      <Text
        as="h1"
        size="3xl"
        style="serif"
        className="mb-8 text-[2rem] font-[300] leading-tight text-ink"
      >
        {children}
      </Text>
    );
  },
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
  pre({ children }: { children?: React.ReactNode }) {
    return (
      <pre className="mb-8 overflow-x-auto rounded-md border border-amber/25 bg-[#17130d] p-4 font-mono text-sm leading-relaxed text-ink">
        {children}
      </pre>
    );
  },
  code({ children, className }: React.HTMLAttributes<HTMLElement>) {
    return <Code className={className}>{children}</Code>;
  },
  table({ children }: { children?: React.ReactNode }) {
    return (
      <div className="mb-8 overflow-x-auto">
        <table className="min-w-[720px] border-collapse text-left text-sm leading-relaxed text-muted [&_thead_td]:text-white">
          {children}
        </table>
      </div>
    );
  },
  th({ children }: { children?: React.ReactNode }) {
    return <th className="border-b border-rule px-3 py-3 font-semibold text-ink">{children}</th>;
  },
  td({ children }: { children?: React.ReactNode }) {
    return <td className="border-b border-rule px-3 py-3 align-top">{children}</td>;
  },
  img({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) {
    if (!src) {
      return null;
    }

    return (
      <span className="mb-10 block">
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          className="w-full rounded-md border border-rule bg-[#17130d]"
        />
        {alt ? <span className="mt-3 block text-sm leading-relaxed text-muted/70">{alt}</span> : null}
      </span>
    );
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
      <BlogPostMeta post={post} />
      <BlogPostStructuredData post={post} />
      <article className="mx-auto max-w-[800px] pt-8 pb-20">
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
