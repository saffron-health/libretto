import { Route, Switch } from "wouter";
import { HomePage } from "./HomePage";
import { BlogIndexPage, BlogPostPage } from "./blog/BlogPage";
import { BrowserUsePage } from "./vs/BrowserUsePage";
import { PlaywrightCodegenPage } from "./vs/PlaywrightCodegenPage";
import { StagehandPage } from "./vs/StagehandPage";
import { SignInPage } from "./SignInPage";
import { DashboardPage } from "./DashboardPage";
import { OnboardingPage } from "./OnboardingPage";
import { InvitePage } from "./InvitePage";
import { VerifyEmailPage } from "./VerifyEmailPage";

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
      <Route path="/signin" component={SignInPage} />
      <Route path="/verify-email" component={VerifyEmailPage} />
      <Route path="/invite" component={InvitePage} />
      <Route path="/onboarding" component={OnboardingPage} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="*" component={HomePage} />
    </Switch>
  );
}
