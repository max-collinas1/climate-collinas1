import SiteHeader from "./SiteHeader";

export default function SiteLayout({ children, headerProps = null }) {
  return (
    <div className="page">
      <div className="pageInner">
        {headerProps ? <SiteHeader {...headerProps} /> : null}
        {children}
      </div>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background:
            radial-gradient(
              1200px 400px at 20% 0%,
              rgba(15, 23, 42, 0.05),
              transparent 60%
            ),
            radial-gradient(
              900px 350px at 90% 10%,
              rgba(2, 132, 199, 0.07),
              transparent 55%
            ),
            linear-gradient(180deg, #ffffff, #f8fafc);
          padding: 18px 10px 50px;
        }

        .pageInner {
          max-width: 1280px;
          margin: 0 auto;
        }
      `}</style>
    </div>
  );
}