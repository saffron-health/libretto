import { Route, Switch } from "wouter";
import { HomePage } from "./HomePage";
import { BlogIndexPage, BlogPostPage } from "./blog/BlogPage";
import { BrowserUsePage } from "./vs/BrowserUsePage";
import { StagehandPage } from "./vs/StagehandPage";

export function App() {
  return (
    <Switch>
      <Route path="/blog" component={BlogIndexPage} />
      <Route path="/blog/:slug">{(params) => <BlogPostPage slug={params.slug ?? ""} />}</Route>
      <Route path="/vs/browser-use" component={BrowserUsePage} />
      <Route path="/vs/stagehand" component={StagehandPage} />
      <Route path="*" component={HomePage} />
    </Switch>
  );
}
