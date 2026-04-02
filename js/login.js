const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const switchToRegister = document.getElementById("switchToRegister");
const switchToLogin = document.getElementById("switchToLogin");
const loginTitle = document.getElementById("loginTitle");
const loginSubtitle = document.getElementById("loginSubtitle");

function showLogin(){
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    loginTitle.innerText = "Welcome back";
    loginSubtitle.innerText = "Sign in to your account";
}

function showRegister(){
    registerForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
    loginTitle.innerText = "Create an account";
    loginSubtitle.innerText = "Join Atlantic Metals today";
}

tabLogin.addEventListener("click", showLogin);
tabRegister.addEventListener("click", showRegister);
switchToRegister.addEventListener("click", showRegister);
switchToLogin.addEventListener("click", showLogin);

const urlParams = new URLSearchParams(window.location.search);
if(urlParams.get("tab") === "register"){
    showRegister();
}

function togglePassword(btn){
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if(input.type === "password"){
        input.type = "text";
        btn.innerText = "Hide";
    } else {
        input.type = "password";
        btn.innerText = "Show";
    }
}

document.getElementById("toggleLoginPw").addEventListener("click", function(){
    togglePassword(this);
});

document.getElementById("toggleRegPw").addEventListener("click", function(){
    togglePassword(this);
});

document.getElementById("toggleRegConfirm").addEventListener("click", function(){
    togglePassword(this);
});

function showError(id, msg){
    const el = document.getElementById(id);
    el.innerText = msg;
    el.style.display = "block";
}

function clearError(id){
    const el = document.getElementById(id);
    el.innerText = "";
    el.style.display = "none";
}

function isValidEmail(email){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone){
    return /^[\d\s\+\-\(\)]{7,15}$/.test(phone);
}

document.getElementById("loginBtn").addEventListener("click", function(){
    clearError("loginError");

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const remember = document.getElementById("rememberMe").checked;

    if(!email || !isValidEmail(email)){
        showError("loginError", "Please enter a valid email address.");
        return;
    }

    if(!password || password.length < 6){
        showError("loginError", "Please enter your password.");
        return;
    }

    const users = JSON.parse(localStorage.getItem("am_users") || "[]");
    const user = users.find(u => u.email === email && u.password === password);

    if(!user){
        showError("loginError", "Incorrect email or password.");
        return;
    }

    const session = { firstName: user.firstName, lastName: user.lastName, email: user.email };

    if(remember){
        localStorage.setItem("am_session", JSON.stringify(session));
    } else {
        sessionStorage.setItem("am_session", JSON.stringify(session));
    }

    window.location.href = "index.html";
});

document.getElementById("registerBtn").addEventListener("click", function(){
    clearError("registerError");

    const firstName = document.getElementById("regFirstName").value.trim();
    const lastName = document.getElementById("regLastName").value.trim();
    const phone = document.getElementById("regPhone").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;
    const confirm = document.getElementById("regConfirm").value;

    if(!firstName){
        showError("registerError", "Please enter your first name.");
        return;
    }

    if(!lastName){
        showError("registerError", "Please enter your last name.");
        return;
    }

    if(!phone || !isValidPhone(phone)){
        showError("registerError", "Please enter a valid phone number.");
        return;
    }

    if(!email || !isValidEmail(email)){
        showError("registerError", "Please enter a valid email address.");
        return;
    }

    if(!password || password.length < 6){
        showError("registerError", "Password must be at least 6 characters.");
        return;
    }

    if(password !== confirm){
        showError("registerError", "Passwords do not match.");
        return;
    }

    const users = JSON.parse(localStorage.getItem("am_users") || "[]");
    const exists = users.find(u => u.email === email);

    if(exists){
        showError("registerError", "An account with this email already exists.");
        return;
    }

    users.push({ firstName, lastName, phone, email, password });
    localStorage.setItem("am_users", JSON.stringify(users));

    const session = { firstName, lastName, email };
    sessionStorage.setItem("am_session", JSON.stringify(session));

    window.location.href = "index.html";
});