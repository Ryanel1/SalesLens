"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import type { Customer } from "@/lib/types";

export default function Home() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerStatus, setCustomerStatus] = useState("Loading accounts...");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setCustomers([]);
      return;
    }

    let isMounted = true;
    setCustomerStatus("Loading accounts...");
    supabase
      .from("customers")
      .select("id,name,display_order")
      .order("display_order", { ascending: true })
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          setCustomerStatus(error.message);
          return;
        }
        setCustomers(data ?? []);
        setCustomerStatus("");
      });

    return () => {
      isMounted = false;
    };
  }, [user]);

  async function signIn() {
    setStatus("Sending sign-in link...");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: typeof window === "undefined" ? undefined : window.location.origin,
      },
    });

    setStatus(error ? error.message : "Check your email for the SalesLens sign-in link.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setStatus("");
  }

  if (user) {
    return (
      <main className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Lester Sales</p>
            <h1>SalesLens</h1>
          </div>
          <button className="ghostButton" onClick={signOut}>
            Sign Out
          </button>
        </header>

        <section className="heroPanel">
          <p className="eyebrow">Connected to Supabase</p>
          <h2>Web dashboard foundation is live.</h2>
          <p>
            Next we will add the hosted database tables, import your current Mac app records,
            then rebuild the Volshop and Rebel Rags dashboards for web and mobile.
          </p>
        </section>

        <section className="grid">
          <article className="wideCard">
            <span>01</span>
            <h3>Accounts</h3>
            {customerStatus ? <p>{customerStatus}</p> : null}
            {!customerStatus && customers.length === 0 ? <p>No accounts found.</p> : null}
            {customers.length > 0 ? (
              <div className="accountList">
                {customers.map((customer) => (
                  <button className="accountButton" key={customer.id}>
                    {customer.name}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
          <article>
            <span>02</span>
            <h3>Reports</h3>
            <p>Monthly, year-to-date, Top 25 by Art, and PDF exports will be rebuilt here.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Images</h3>
            <p>Product image overrides and cached Rebel Rags images will move into Supabase Storage.</p>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="loginShell">
      <section className="loginPanel">
        <p className="eyebrow">Private Sales Dashboard</p>
        <h1>SalesLens</h1>
        <p className="intro">
          Sign in to view sales summaries, compare prior-year performance, and export reports.
        </p>

        <label htmlFor="email">Email</label>
        <div className="loginRow">
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ryanlestersells@gmail.com"
          />
          <button onClick={signIn} disabled={!email}>
            Send Link
          </button>
        </div>
        {status ? <p className="status">{status}</p> : null}
      </section>
    </main>
  );
}
