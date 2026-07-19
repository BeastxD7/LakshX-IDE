import Hero from "./components/Hero";
import Features from "./components/Features";
import Pricing from "./components/Pricing";
import SiteFooter from "./components/SiteFooter";

export default function Home() {
  return (
    <main>
      <div id="top">
        <Hero />
      </div>
      <Features />
      <Pricing />
      <SiteFooter />
    </main>
  );
}
