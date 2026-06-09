import type { BlogPost } from "../../scripts/blog-posts.mjs";

type JsonPrimitive = string | number | boolean | null;
type JsonObject = { [key: string]: JsonValue | undefined };
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

const SITE_URL = "https://libretto.sh";
const BLOG_URL = `${SITE_URL}/blog`;

function getBlogPostUrl(post: Pick<BlogPost, "slug">): string {
  return `${BLOG_URL}/${post.slug}`;
}

export function getAbsoluteBlogPostUrl(post: Pick<BlogPost, "slug">): string {
  return getBlogPostUrl(post);
}

export function getAbsoluteBlogPostImageUrl(post: Pick<BlogPost, "ogImage">): string {
  return `${SITE_URL}${post.ogImage}`;
}

export function serializeJsonLd(value: JsonValue): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildBlogPostJsonLd(
  post: Pick<BlogPost, "description" | "ogImage" | "publishedAt" | "slug" | "title">,
): JsonValue {
  const postUrl = getBlogPostUrl(post);
  const imageUrl = getAbsoluteBlogPostImageUrl(post);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        headline: post.title,
        description: post.description,
        author: {
          "@type": "Person",
          name: "Tanishq Kancharla",
          jobTitle: "Founder",
          sameAs: ["https://www.linkedin.com/in/tanishq-k/"],
        },
        publisher: {
          "@type": "Organization",
          name: "Libretto",
          url: SITE_URL,
          logo: {
            "@type": "ImageObject",
            url: `${SITE_URL}/logos/logo-light.svg`,
          },
        },
        datePublished: post.publishedAt,
        dateModified: post.publishedAt,
        image: {
          "@type": "ImageObject",
          url: imageUrl,
          width: 1200,
          height: 630,
        },
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": postUrl,
        },
        url: postUrl,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Blog",
            item: BLOG_URL,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: post.title,
            item: postUrl,
          },
        ],
      },
      {
        "@type": "WebSite",
        name: "Libretto",
        url: SITE_URL,
      },
    ],
  };
}
