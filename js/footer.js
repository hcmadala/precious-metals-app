const footerHTML = `
<footer class="site-footer">
    <div class="footer-inner">
        <div class="footer-brand">
            <a href="index.html" class="footer-brand-name">Atlantic Metals</a>
            <p>Canada's trusted source for investment grade precious metals. Government minted coins and bars at competitive premiums.</p>
        </div>
        <div class="footer-links">
            <h4>Shop</h4>
            <a href="products.html">Shop All</a>
            <a href="products.html?metal=gold">Gold</a>
            <a href="products.html?metal=silver">Silver</a>
            <a href="products.html?metal=platinum">Platinum</a>
            <a href="products.html?metal=palladium">Palladium</a>
        </div>
        <div class="footer-links">
            <h4>Company</h4>
            <a href="#">About Us</a>
            <a href="#">Contact</a>
            <a href="#">FAQ</a>
            <a href="#">Shipping Policy</a>
            <a href="#">Price Match</a>
        </div>
        <div class="footer-links">
            <h4>Account</h4>
            <a href="login.html">Sign In</a>
            <a href="login.html?tab=register">Register</a>
            <a href="#">Order History</a>
            <a href="#">My Portfolio</a>
        </div>
    </div>
    <div class="footer-bottom">
        <p>© 2026 Atlantic Metals. All rights reserved.</p>
        <div class="footer-bottom-links">
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Use</a>
            <a href="#">Cookie Policy</a>
        </div>
    </div>
</footer>
`;

document.body.insertAdjacentHTML("beforeend", footerHTML);