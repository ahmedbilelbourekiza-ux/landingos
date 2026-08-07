/**
 * Apply the stored table density before the first paint — UI.13.
 *
 * The same problem `next-themes` solves for the colour scheme, and the same
 * shape of answer: a preference held in `localStorage` cannot be known on the
 * server, so reading it in an effect means every navigation paints at the
 * default and then jumps — for exactly the people who chose compact because
 * they are scanning quickly.
 *
 * `beforeInteractive` is not available in a layout body, and a `<script>` in
 * the tree runs where it is placed, which is early enough: it sits above
 * `{children}` so the attribute is on `<html>` before the table's own CSS is
 * evaluated against it.
 *
 * It is deliberately tiny and total. `try/catch` because a browser with storage
 * blocked throws on read, and a console that fails to render over a row-height
 * preference would be a spectacular trade.
 */
export function DensityScript() {
  return (
    <script
      // The value is a constant in this file — nothing from a request, a
      // parameter or the database reaches it, which is the only condition under
      // which this is not an injection surface.
      dangerouslySetInnerHTML={{
        __html:
          "try{var d=localStorage.getItem('landingos.density');" +
          "if(d==='compact'||d==='comfortable')document.documentElement.dataset.density=d;}catch(e){}",
      }}
    />
  );
}
