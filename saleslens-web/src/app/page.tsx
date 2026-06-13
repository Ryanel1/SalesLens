"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { currencyText, dateText, monthText, numberText } from "@/lib/formatters";
import type { Customer, CustomerSummary } from "@/lib/types";

export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerStatus, setCustomerStatus] = useState("Loading accounts...");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [summaryStatus, setSummaryStatus] = useState("");

  useEffect(() => {
    if (!supabase) {
      setStatus("SalesLens is missing Supabase environment variables.");
      return;
    }

    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setCustomerStatus("SalesLens is missing Supabase environment variables.");
      return;
    }

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
        setSelectedCustomerId((current) => current ?? data?.[0]?.id ?? null);
        setCustomerStatus("");
      });

    return () => {
      isMounted = false;
    };
  }, [supabase, user]);

  useEffect(() => {
    if (!supabase || !selectedCustomerId) {
      setSummary(null);
      return;
    }

    let isMounted = true;
    setSummaryStatus("Loading sales summary...");

    async function loadSummary() {
      const { data, error } = await supabase
        .from("sales_records")
        .select("amount,units,transaction_date")
        .eq("customer_id", selectedCustomerId);

      if (!isMounted) return;

      if (error) {
        setSummaryStatus(error.message);
        setSummary(null);
        return;
      }

      const records = data ?? [];
      const dates = records
        .map((record) => record.transaction_date)
        .filter((date): date is string => Boolean(date))
        .sort();
      const months = [...new Set(dates.map((date) => date.slice(0, 7)))]
        .sort()
        .reverse();

      setSummary({
        customerId: selectedCustomerId,
        sales: records.reduce((total, record) => total + Number(record.amount ?? 0), 0),
        units: records.reduce((total, record) => total + Number(record.units ?? 0), 0),
        transactions: records.length,
        earliestDate: dates[0] ?? null,
        latestDate: dates.at(-1) ?? null,
        latestMonth: months[0] ?? null,
        months,
      });
      setSummaryStatus("");
    }

    loadSummary();

    return () => {
      isMounted = false;
    };
  }, [supabase, selectedCustomerId]);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;

  async function signIn() {
    if (!supabase) {
      setStatus("SalesLens is missing Supabase environment variables.");
      return;
    }

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
    if (!supabase) return;
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
                  <button
                    className={customer.id === selectedCustomerId ? "accountButton active" : "accountButton"}
                    key={customer.id}
                    onClick={() => setSelectedCustomerId(customer.id)}
                  >
                    {customer.name}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
          <article className="wideCard">
            <span>02</span>
            <h3>{selectedCustomer?.name ?? "Account"} Summary</h3>
            {summaryStatus ? <p>{summaryStatus}</p> : null}
            {summary ? (
              <>
                <div className="metricGrid">
                  <div className="metric">
                    <p>Sales</p>
                    <strong>{currencyText(summary.sales)}</strong>
                  </div>
                  <div className="metric">
                    <p>Units</p>
                    <strong>{numberText(summary.units)}</strong>
                  </div>
                  <div className="metric">
                    <p>Transactions</p>
                    <strong>{numberText(summary.transactions)}</strong>
                  </div>
                  <div className="metric">
                    <p>Last Date Uploaded</p>
                    <strong>{dateText(summary.latestDate)}</strong>
                  </div>
                </div>
                <div className="summaryLine">
                  <span>Range: {dateText(summary.earliestDate)} to {dateText(summary.latestDate)}</span>
                  <span>Latest Month: {monthText(summary.latestMonth)}</span>
                  <span>Months Loaded: {numberText(summary.months.length)}</span>
                </div>
              </>
            ) : null}
          </article>
          <article>
            <span>03</span>
            <h3>Reports</h3>
            <p>Monthly, year-to-date, Top 25 by Art, and PDF exports will be rebuilt here.</p>
          </article>
          <article>
            <span>04</span>
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
