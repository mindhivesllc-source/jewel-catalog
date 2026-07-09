// import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
// import { Outlet, useLoaderData, useRouteError, useNavigate, useLocation } from "react-router";
// import { boundary } from "@shopify/shopify-app-react-router/server";
// import { AppProvider } from "@shopify/shopify-app-react-router/react";

// import { authenticate } from "../shopify.server";

// export const loader = async ({ request }: LoaderFunctionArgs) => {
//   await authenticate.admin(request);

//   // eslint-disable-next-line no-undef
//   return { apiKey: process.env.SHOPIFY_API_KEY || "" };
// };

// /* ── Inline nav bar (replaces unsupported s-app-nav) ────────── */

// const NAV_ITEMS = [
//   { href: "/app", icon: "📦", label: "Catalog" },
//   { href: "/app/settings", icon: "⚙", label: "Settings" },
//   { href: "/app/history", icon: "🕐", label: "History" },
// ];

// function NavBar() {
//   const location = useLocation();
//   const navigate = useNavigate();

//   return (
//     <nav
//       style={{
//         display: "flex",
//         gap: "4px",
//         borderBottom: "1px solid var(--p-border, #e1e3e5)",
//         paddingBottom: "8px",
//         marginBottom: "16px",
//       }}
//     >
//       {NAV_ITEMS.map((item) => {
//         const active = location.pathname === item.href;
//         return (
//           <a
//             key={item.href}
//             href={item.href}
//             onClick={(e) => {
//               e.preventDefault();
//               navigate(item.href);
//             }}
//             style={{
//               padding: "8px 16px",
//               borderRadius: "4px 4px 0 0",
//               textDecoration: "none",
//               fontWeight: active ? 600 : 400,
//               color: active
//                 ? "var(--p-interactive, #2c6ecb)"
//                 : "var(--p-text, #202223)",
//               borderBottom: active
//                 ? "2px solid var(--p-interactive, #2c6ecb)"
//                 : "2px solid transparent",
//               background: active
//                 ? "var(--p-surface-hovered, #f1f1f1)"
//                 : "transparent",
//               cursor: "pointer",
//             }}
//           >
//             {item.icon} {item.label}
//           </a>
//         );
//       })}
//     </nav>
//   );
// }

// /* ── App layout ─────────────────────────────────────────────── */

// export default function App() {
//   const { apiKey } = useLoaderData<typeof loader>();

//   return (
//     <AppProvider embedded apiKey={apiKey}>
//       <s-page heading="">
//         <NavBar />
//         <Outlet />
//       </s-page>
//     </AppProvider>
//   );
// }

// // Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
// export function ErrorBoundary() {
//   return boundary.error(useRouteError());
// }

// export const headers: HeadersFunction = (headersArgs) => {
//   return boundary.headers(headersArgs);
// };





import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  useLoaderData,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Catalog
        </Link>

        <Link to="/app/settings">
          Settings
        </Link>

        <Link to="/app/history">
          History
        </Link>
      </NavMenu>

      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};