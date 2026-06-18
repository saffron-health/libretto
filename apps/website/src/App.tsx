import { Route, Switch } from "wouter";
import { HomePage } from "./HomePage";
import { BlogIndexPage, BlogPostPage } from "./blog/BlogPage";
import { BrowserUsePage } from "./vs/BrowserUsePage";
import { PlaywrightCodegenPage } from "./vs/PlaywrightCodegenPage";
import { StagehandPage } from "./vs/StagehandPage";

function VsRoutes() {
  return (
    <Switch>
      <Route path="/browser-use" component={BrowserUsePage} />
      <Route path="/playwright-codegen" component={PlaywrightCodegenPage} />
      <Route path="/stagehand" component={StagehandPage} />
      <Route path="*" component={HomePage} />
    </Switch>
  );
}

export function App() {
  return (
    <Switch>
      <Route path="/blog" component={BlogIndexPage} />
      <Route path="/blog/:slug">
        {(params) => <BlogPostPage slug={params.slug ?? ""} />}
      </Route>
      <Route path="/vs" nest component={VsRoutes} />
      <Route path="*" component={HomePage} />
    </Switch>
  );
}
