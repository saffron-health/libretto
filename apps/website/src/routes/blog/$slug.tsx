import { createFileRoute } from "@tanstack/react-router";
import { BlogPostPage } from "../../blog/BlogPage";
import { getAbsoluteBlogPostImageUrl, getAbsoluteBlogPostUrl } from "../../blog/jsonLd";
import { getBlogPost } from "../../blog/posts";

export const Route = createFileRoute("/blog/$slug")({
  head: ({ params }) => {
    const post = getBlogPost(params.slug);
    if (!post) {
      return {};
    }

    const title = `${post.title} | Libretto Blog`;
    const description = post.description;
    const url = getAbsoluteBlogPostUrl(post);
    const imageUrl = getAbsoluteBlogPostImageUrl(post);

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        { property: "og:image", content: imageUrl },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: imageUrl },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: BlogPostRoute,
});

function BlogPostRoute() {
  const { slug } = Route.useParams();

  return <BlogPostPage slug={slug} />;
}
