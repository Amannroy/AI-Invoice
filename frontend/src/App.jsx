import React from "react";
import Home from "./pages/Home";
import { Route, Routes } from "react-router-dom";
import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/clerk-react";
import AppShell from "./components/AppShell";
import Dashboard from "./pages/Dashboard";
import CreateInvoice from "./pages/CreateInvoice";
import Invoices from "./pages/Invoices";
import InvoicePreview from "./components/InvoicePreview";
import BusinessProfile from "./pages/BusinessProfile";

const ClerkProtected = ({ children }) => (
  <>
    <SignedIn>{children}</SignedIn>
    <SignedOut>
      <RedirectToSignIn />
    </SignedOut>
  </>
);

const App = () => {
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden">
      <Routes>
        <Route path="/" element={<Home />} />
        {/* It must be a protected route */}
        <Route
          path="/app"
          element={
            <ClerkProtected>
              <AppShell />
            </ClerkProtected>
          }
        >
        <Route index element={<Dashboard />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/new" element={<CreateInvoice />} />
        <Route path="invoices/:id" element={<InvoicePreview />} />
        <Route path="invoices/:id/preview" element={<InvoicePreview />} />
        <Route path="invoices/:id/edit" element={<CreateInvoice />} />

        <Route path="create-invoice" element={<CreateInvoice />} />
        <Route path="business" element={<BusinessProfile />} />
        </Route>
      </Routes>
    </div>
  );
};

export default App;
