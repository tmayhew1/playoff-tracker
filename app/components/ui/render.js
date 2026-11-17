// Renders through a function a component builds while it renders.
//
// A view often wants a small local element builder that closes over its
// state — a sortable column header, one row of a board. Written as a
// component (`const H = (props) => <button…>` and then `<H …/>`) it is a NEW
// component type on every render, so React throws the old element away and
// mounts a fresh one: a header button that was just pressed from the keyboard
// loses focus the moment its own click re-sorts the table.
//
// `<Render fn={H} …/>` keeps the builder local but gives React one stable
// type to reconcile against, so the DOM node — and focus on it — survives.
// `fn` must not call hooks.
export const Render = ({ fn, ...props }) => fn(props);
