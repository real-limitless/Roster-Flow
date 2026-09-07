import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Access, Bots, Changelog, HarnessPage, Orchestration, OrgPage, Pricing, Product, Security } from "./pages/Pages";
import { Settings } from "./pages/Settings";
import { Workspace } from "./pages/Workspace";

export default function App() {
  return (
    <Routes>
      <Route path="/app" element={<Workspace />} />
      <Route path="/app/settings" element={<Settings />} />
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
