import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireWorkspace } from "./lib/auth";
import { Home } from "./pages/Home";
import { Access, Bots, Changelog, HarnessPage, Orchestration, OrgPage, Pricing, Product, Security } from "./pages/Pages";
import { BlockKitBuilder } from "./pages/BlockKitBuilder";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { Setup } from "./pages/Setup";
import { Workspace } from "./pages/Workspace";

export default function App() {
  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route element={<RequireWorkspace />}>
        <Route path="/app" element={<Workspace />} />
        <Route path="/app/blocks" element={<BlockKitBuilder />} />
        <Route path="/app/settings" element={<Settings />} />
      </Route>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/product" element={<Product />} />
        <Route path="/bots" element={<Bots />} />
        <Route path="/orchestration" element={<Orchestration />} />
        <Route path="/harness" element={<HarnessPage />} />
        <Route path="/org" element={<OrgPage />} />
        <Route path="/orgs" element={<Navigate to="/org" replace />} />
        <Route path="/security" element={<Security />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/access" element={<Access />} />
        <Route path="/contact" element={<Navigate to="/access" replace />} />
      </Route>
    </Routes>
  );
}
