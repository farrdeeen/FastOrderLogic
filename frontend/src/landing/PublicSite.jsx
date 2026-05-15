import { SignInButton } from "@clerk/clerk-react";
import { useEffect, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import MenuIcon from "@mui/icons-material/Menu";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import logo from "../assets/logo.png";

const productUrl = "https://mtm-store.com/products";
const productImageBase = "https://mtm-store.com/api/static";
const whatsAppUrl = "https://wa.me/message/SKD3PIKGJ7IYE1";

function productImage(path) {
  return `${productImageBase}/${String(path || "").replace(/^\/+/, "")}`;
}

const navItems = [
  { label: "Home", href: "#home" },
  { label: "About Us", href: "#about" },
  { label: "Our Products", href: productUrl },
  { label: "Our Services", href: "#services" },
  { label: "Contact Us", href: "#contact" },
];

const stats = [
  { value: "2020", label: "Established" },
  { value: "2000+", label: "CSP points supported" },
  { value: "500+", label: "Retailer network" },
  { value: "Pan India", label: "Field coverage" },
];

const productPreviews = [
  {
    tag: "Sale Promo",
    name: "DaSh GeoNova GPS Receiver",
    price: "Rs. 2,250",
    detail: "For Aadhaar and CSP banking location compliance.",
    image: productImage(
      "/product_images/01acd25dd0b94b95bd4a5f9cd25c62cd_DaSh_GeoNova_GPS_Receiver_2.png",
    ),
  },
  {
    tag: "Best Selling",
    name: "Raivens USB GPS Receiver 8.0",
    price: "Rs. 4,210",
    detail: "GPS receiver with optional antenna for Bank CSP use.",
    image: productImage(
      "/product_images/1205d52f9edd4720b1578ac2ec86926a_rv.png",
    ),
  },
  {
    tag: "Best Selling",
    name: "MANTRA MFS110 L1 Biometric",
    price: "Rs. 2,410",
    detail: "Fingerprint scanner with RD service for Aadhaar workflows.",
    image: productImage(
      "/product_images/5fae1ce9292a42b7ba9a6e5d77fe5d7a_sq.png",
    ),
  },
  {
    tag: "Printer",
    name: "DaSh iSH58 Thermal Receipt Printer",
    price: "Rs. 2,270",
    detail: "USB and Bluetooth receipt printer for field billing.",
    image: productImage(
      "/product_images/065e8ecefb1f4ed086c3dde2a3547574_ish58.png",
    ),
  },
  {
    tag: "Passbook",
    name: "Epson PLQ-35 Passbook Printer",
    price: "Rs. 29,500",
    detail: "Banking document printer for CSP passbook work.",
    image: productImage(
      "/product_images/e48365b587914b978629da3df08fd337_PLQ_35.png",
    ),
  },
  {
    tag: "mPOS",
    name: "Pax D180C Micro ATM Pinpad",
    price: "Rs. 2,310",
    detail: "Compact pinpad device for transaction support.",
    image: productImage(
      "/product_images/f0490f55f2f94df292eafb71d1422f53_PAX_D180.png",
    ),
  },
];

const serviceCards = [
  {
    title: "Business Correspondent Network",
    text: "A field-ready CSP network supported by experienced retailers, coordinators, and customer support teams across key Indian regions.",
  },
  {
    title: "Managed IT & Network Solutions",
    text: "Practical technology support for uptime, network management, planning, security, and remote troubleshooting.",
  },
  {
    title: "mTm DāSh Store on IndiaMART",
    text: "Bulk catalogue support for scanners, GPS receivers, Aadhaar kits, micro-ATMs, printers, and electronic accessories.",
  },
  {
    title: "Sales & Aftersales Support",
    text: "Device selection, setup help, remote support, corporate bulk requirements, and reseller-friendly supply.",
  },
];

const salesPoints = [
  "Fintech and IT hardware sales division",
  "Bulk requirements for corporate clients",
  "Presence on IndiaMART, Exporter India, GeM, and MSME channels",
  "Aftersales support through experienced support staff",
];

export default function PublicSite() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const scriptSrc = "https://static.elfsight.com/platform/platform.js";
    if (document.querySelector(`script[src="${scriptSrc}"]`)) return;
    const script = document.createElement("script");
    script.src = scriptSrc;
    script.defer = true;
    script.dataset.useServiceCore = "";
    document.body.appendChild(script);
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <main className="public-site">
      <style>{`
        .public-site {
          min-height: 100dvh;
          background: #f5f7f4;
          color: #13211d;
          font-family: "IBM Plex Sans", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          overflow-x: hidden;
        }

        .public-nav {
          position: sticky;
          top: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          min-height: 74px;
          padding: 12px clamp(16px, 4vw, 56px);
          background: rgba(245, 247, 244, 0.95);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(19, 33, 29, 0.09);
        }

        .public-menu-toggle {
          display: none;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          border: 1px solid #d1ded8;
          border-radius: 8px;
          background: #fff;
          color: #13211d;
          cursor: pointer;
        }

        .public-brand {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-width: max-content;
          color: inherit;
          text-decoration: none;
          font-weight: 950;
          letter-spacing: 0;
        }

        .public-brand img {
          width: 42px;
          height: 42px;
          object-fit: contain;
          border-radius: 8px;
        }

        .public-brand span {
          font-size: 20px;
        }

        .public-nav-links {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          flex: 1;
          min-width: 0;
        }

        .public-nav-links a {
          color: #33433d;
          text-decoration: none;
          font-size: 14px;
          font-weight: 850;
          padding: 10px 12px;
          border-radius: 8px;
          white-space: nowrap;
        }

        .public-nav-links a:hover {
          background: #e9f1ee;
          color: #006a55;
        }

        .public-login {
          border: 0;
          border-radius: 8px;
          background: #006a55;
          color: #fff;
          font-size: 14px;
          font-weight: 900;
          padding: 11px 18px;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(0, 106, 85, 0.22);
          white-space: nowrap;
        }

        .public-login:hover {
          background: #005443;
        }

        .public-hero {
          position: relative;
          min-height: calc(78dvh - 74px);
          display: flex;
          align-items: center;
          padding: clamp(46px, 8vw, 92px) clamp(18px, 6vw, 86px);
          isolation: isolate;
          overflow: hidden;
        }

        .public-hero::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image: url("${logo}");
          background-size: min(620px, 92vw);
          background-repeat: no-repeat;
          background-position: right clamp(14px, 8vw, 94px) center;
          opacity: 0.13;
          z-index: -1;
        }

        .public-hero-copy {
          width: min(820px, 100%);
        }

        .public-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin: 0 0 16px;
          padding: 8px 11px;
          border: 1px solid #b8d7ce;
          border-radius: 999px;
          color: #006a55;
          background: #eef8f5;
          font-size: 13px;
          font-weight: 900;
        }

        .public-hero h1 {
          margin: 0;
          color: #11201b;
          font-size: clamp(42px, 9vw, 88px);
          line-height: 0.96;
          letter-spacing: 0;
          font-weight: 950;
        }

        .public-hero p {
          max-width: 690px;
          margin: 22px 0 0;
          color: #43544e;
          font-size: clamp(17px, 2.1vw, 22px);
          line-height: 1.55;
          font-weight: 650;
        }

        .public-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 28px;
        }

        .public-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 46px;
          padding: 0 18px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 900;
          border: 1px solid transparent;
        }

        .public-button.primary {
          background: #006a55;
          color: #fff;
          box-shadow: 0 12px 26px rgba(0, 106, 85, 0.22);
        }

        .public-button.secondary {
          background: #fff;
          color: #22312c;
          border-color: #d9e2dd;
        }

        .public-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1px;
          background: #dce7e2;
          border-top: 1px solid #dce7e2;
          border-bottom: 1px solid #dce7e2;
        }

        .public-stat {
          background: #fff;
          padding: 22px clamp(14px, 3vw, 34px);
        }

        .public-stat strong {
          display: block;
          color: #006a55;
          font-size: clamp(24px, 4vw, 38px);
          line-height: 1;
          letter-spacing: 0;
        }

        .public-stat span {
          display: block;
          margin-top: 8px;
          color: #53635d;
          font-weight: 850;
          font-size: 13px;
          text-transform: uppercase;
        }

        .public-section {
          padding: clamp(42px, 7vw, 82px) clamp(18px, 6vw, 86px);
          border-top: 1px solid rgba(19, 33, 29, 0.08);
        }

        .public-section.light {
          background: #fff;
        }

        .public-section-header {
          max-width: 860px;
          margin-bottom: 28px;
        }

        .public-section-header h2 {
          margin: 0;
          color: #13211d;
          font-size: clamp(28px, 5vw, 48px);
          line-height: 1.05;
          letter-spacing: 0;
        }

        .public-section-header p {
          margin: 14px 0 0;
          color: #53635d;
          font-size: 17px;
          line-height: 1.6;
          font-weight: 650;
        }

        .public-two-column {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(280px, 0.95fr);
          gap: clamp(18px, 4vw, 44px);
          align-items: start;
        }

        .public-panel {
          background: #f7faf8;
          border: 1px solid #dfe7e3;
          border-radius: 8px;
          padding: clamp(18px, 3vw, 28px);
        }

        .public-panel h3,
        .public-card h3,
        .public-product h3,
        .public-review h3 {
          margin: 0;
          color: #172b24;
          font-size: 20px;
          line-height: 1.2;
          letter-spacing: 0;
        }

        .public-panel p,
        .public-card p,
        .public-product p,
        .public-review p {
          margin: 12px 0 0;
          color: #5a6b65;
          line-height: 1.55;
          font-weight: 650;
        }

        .public-mini-list {
          display: grid;
          gap: 10px;
          margin: 16px 0 0;
          padding: 0;
          list-style: none;
        }

        .public-mini-list li {
          padding: 12px 14px;
          border-radius: 8px;
          background: #fff;
          border: 1px solid #dfe7e3;
          color: #263731;
          font-weight: 850;
          line-height: 1.4;
        }

        .public-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }

        .public-card {
          background: #fff;
          border: 1px solid #dfe7e3;
          border-radius: 8px;
          padding: 22px;
          min-height: 198px;
          box-shadow: 0 8px 24px rgba(20, 32, 28, 0.05);
        }

        .public-products {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }

        .public-product {
          display: flex;
          flex-direction: column;
          min-height: 254px;
          color: inherit;
          text-decoration: none;
          background: #fff;
          border: 1px solid #dfe7e3;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 8px 24px rgba(20, 32, 28, 0.05);
        }

        .public-product-media {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 174px;
          padding: 16px;
          background: #f8fbfa;
          border-bottom: 1px solid #dfe7e3;
        }

        .public-product-media img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .public-product-body {
          display: flex;
          flex-direction: column;
          flex: 1;
          padding: 18px;
        }

        .public-product-tag {
          align-self: flex-start;
          margin-bottom: 12px;
          padding: 5px 8px;
          border-radius: 999px;
          color: #005443;
          background: #e2f2ed;
          font-size: 12px;
          font-weight: 950;
        }

        .public-product-price {
          margin-top: auto;
          padding-top: 16px;
          color: #006a55;
          font-size: 18px;
          font-weight: 950;
        }

        .public-review-widget {
          background: #fff;
          border: 1px solid #dfe7e3;
          border-radius: 8px;
          padding: clamp(12px, 2vw, 20px);
          min-height: 180px;
          overflow: hidden;
        }

        .public-contact {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 24px;
          align-items: end;
        }

        .public-contact-links {
          display: grid;
          gap: 9px;
          min-width: min(360px, 100%);
        }

        .public-contact-links a {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          padding: 14px 16px;
          color: #13211d;
          text-decoration: none;
          background: #fff;
          border: 1px solid #dfe7e3;
          border-radius: 8px;
          font-weight: 900;
        }

        .public-footer {
          padding: 22px clamp(18px, 6vw, 86px);
          color: #64746e;
          font-size: 13px;
          font-weight: 750;
          border-top: 1px solid rgba(19, 33, 29, 0.08);
        }

        .public-whatsapp-bubble {
          position: fixed;
          right: clamp(14px, 3vw, 24px);
          bottom: clamp(14px, 3vw, 24px);
          z-index: 30;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 58px;
          height: 58px;
          border-radius: 50%;
          background: #25d366;
          color: #fff;
          box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22);
          text-decoration: none;
        }

        .public-whatsapp-bubble:hover {
          background: #1ebe5d;
        }

        @media (max-width: 1080px) {
          .public-grid,
          .public-products {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 900px) {
          .public-nav {
            align-items: center;
            flex-wrap: nowrap;
            gap: 10px;
            min-height: 64px;
          }

          .public-menu-toggle {
            display: inline-flex;
            margin-left: auto;
          }

          .public-nav-links {
            display: none;
            position: fixed;
            top: 74px;
            left: 12px;
            right: 12px;
            z-index: 25;
            grid-template-columns: 1fr;
            gap: 6px;
            padding: 10px;
            background: #f8fbfa;
            border: 1px solid #d7e3dd;
            border-radius: 8px;
            box-shadow: 0 18px 46px rgba(15, 23, 42, 0.18);
            max-height: calc(100dvh - 88px);
            overflow-y: auto;
          }

          .public-nav-links.open {
            display: grid;
          }

          .public-nav-links a {
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-height: 42px;
            padding: 10px 12px;
            background: #fff;
            border: 1px solid #dfe7e3;
          }

          .public-nav-links .public-login {
            width: 100%;
            min-height: 44px;
            box-shadow: none;
          }

          .public-two-column,
          .public-contact {
            grid-template-columns: 1fr;
          }

          .public-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .public-card {
            min-height: auto;
          }
        }

        @media (max-width: 560px) {
          .public-nav {
            padding: 10px 14px;
          }

          .public-brand span {
            font-size: 18px;
          }

          .public-brand img {
            width: 38px;
            height: 38px;
          }

          .public-login {
            padding: 10px 14px;
          }

          .public-whatsapp-bubble {
            width: 54px;
            height: 54px;
          }

          .public-hero {
            min-height: 72dvh;
            padding-top: 38px;
            padding-bottom: 42px;
          }

          .public-hero::before {
            background-position: center bottom 10px;
            background-size: 88vw;
            opacity: 0.1;
          }

          .public-grid,
          .public-products {
            grid-template-columns: 1fr;
          }

          .public-stat {
            padding: 18px 16px;
          }

          .public-actions .public-button {
            width: 100%;
          }

          .public-contact-links a {
            flex-direction: column;
            gap: 4px;
          }
        }
      `}</style>

      <header className="public-nav">
        <a
          className="public-brand"
          href="#home"
          aria-label="mTm DāSh Store home"
        >
          <img src={logo} alt="mTm DāSh Store" />
          <span>mTm DāSh Store</span>
        </a>

        <button
          className="public-menu-toggle"
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? (
            <CloseIcon fontSize="small" />
          ) : (
            <MenuIcon fontSize="small" />
          )}
        </button>

        <nav
          className={`public-nav-links${menuOpen ? " open" : ""}`}
          aria-label="Public site navigation"
        >
          {navItems.map((item) => (
            <a key={item.label} href={item.href} onClick={closeMenu}>
              {item.label}
            </a>
          ))}
          <SignInButton mode="modal">
            <button className="public-login" type="button" onClick={closeMenu}>
              Login
            </button>
          </SignInButton>
        </nav>
      </header>

      <section className="public-hero" id="home">
        <div className="public-hero-copy">
          <h1>mTm DāSh Store</h1>
          <p>
            An effort towards improvising rural supply and service chain through
            e-commerce and app based solutions.
          </p>
          <div className="public-actions">
            <a className="public-button primary" href={productUrl}>
              Browse Products
            </a>
            <a className="public-button secondary" href="#about">
              About mTm
            </a>
          </div>
        </div>
      </section>

      <section className="public-stats" aria-label="mTm company highlights">
        {stats.map((stat) => (
          <div className="public-stat" key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </section>

      <section className="public-section light" id="about">
        <div className="public-section-header">
          <h2>About Us</h2>
          <p>
            Maseehum Task Manager works across Customer Service Point banking,
            electronics sales, field support, and fintech device fulfilment. The
            team supports CSP operators with products, training, technical help,
            and business workflows.
          </p>
        </div>

        <div className="public-two-column">
          <div className="public-panel">
            <h3>All About mTm</h3>
            <p>
              mTm focuses on making banking and lifestyle services easier to
              reach in rural and semi-urban markets through reliable products,
              support teams, and practical operational systems.
            </p>
            <ul className="public-mini-list">
              <li>
                Mission: support financially excluded customers through banking
                access.
              </li>
              <li>
                Vision: bring urban banking and lifestyle facilities closer to
                rural users.
              </li>
              <li>
                Leadership: guided by Mr. Ashfaq Ahmad's long field experience
                in CSP networks.
              </li>
            </ul>
          </div>

          <div className="public-panel">
            <h3>mTm Sales</h3>
            <p>
              The sales division handles fintech and IT hardware for CSPs,
              corporate buyers, resellers, and field operators.
            </p>
            <ul className="public-mini-list">
              {salesPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="public-section" id="products">
        <div className="public-section-header">
          <h2>Our Products</h2>
          <p>
            Product previews are shown here for quick scanning. The full live
            catalogue, pricing, filters, and checkout continue on mTm Store.
          </p>
        </div>

        <div className="public-products">
          {productPreviews.map((item) => (
            <a className="public-product" href={productUrl} key={item.name}>
              <div className="public-product-media">
                <img src={item.image} alt={item.name} loading="lazy" />
              </div>
              <div className="public-product-body">
                <span className="public-product-tag">{item.tag}</span>
                <h3>{item.name}</h3>
                <p>{item.detail}</p>
                <div className="public-product-price">{item.price}</div>
              </div>
            </a>
          ))}
        </div>

        <div className="public-actions">
          <a className="public-button primary" href={productUrl}>
            Open Full Product Catalogue
          </a>
        </div>
      </section>

      <section className="public-section light" id="services">
        <div className="public-section-header">
          <h2>Our Services</h2>
          <p>
            mTm combines CSP network operations, product supply, managed IT
            support, and aftersales help so operators can focus on serving their
            customers.
          </p>
        </div>

        <div className="public-grid">
          {serviceCards.map((service) => (
            <article className="public-card" key={service.title}>
              <h3>{service.title}</h3>
              <p>{service.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section" id="reviews">
        <div className="public-section-header">
          <h2>Google Reviews</h2>
          <p>
            Real customer reviews from the mTm DāSh Store public review widget.
          </p>
        </div>

        <div className="public-review-widget">
          <div className="elfsight-app-8d83c214-7a1f-41bc-8728-f68a43c5778d" />
        </div>
      </section>

      <section className="public-section light" id="contact">
        <div className="public-contact">
          <div className="public-section-header">
            <h2>Contact Us</h2>
            <p>
              Reach the sales and technical support team for product guidance,
              order help, setup support, bulk enquiries, and business
              partnerships.
            </p>
          </div>
          <div className="public-contact-links">
            <a href="mailto:sales@mtm-store.com">
              <span>Email</span>
              <span>sales@mtm-store.com</span>
            </a>
            <a href="tel:+911147186444">
              <span>Phone</span>
              <span>011-47186444</span>
            </a>
            <a href="tel:+917303883845">
              <span>Mobile</span>
              <span>7303883845</span>
            </a>
          </div>
        </div>
      </section>

      <footer className="public-footer">
        (c) 2026 Maseehum Task Manager Pvt. Ltd. All rights reserved.
      </footer>

      <a
        className="public-whatsapp-bubble"
        href={whatsAppUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="Chat with mTm DāSh Store sales team on WhatsApp"
        title="Thank you for reaching out to us. For sales inquiries and product assistance, connect with our sales team on WhatsApp."
      >
        <WhatsAppIcon />
      </a>
    </main>
  );
}
