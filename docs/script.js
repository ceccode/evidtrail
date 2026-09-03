// Copy install command functionality
function copyInstallCommand() {
    const command = 'npm install -g @evidtrail/cli';
    
    if (navigator.clipboard && window.isSecureContext) {
        // Use modern clipboard API
        navigator.clipboard.writeText(command).then(() => {
            showCopyFeedback();
        }).catch(() => {
            fallbackCopy(command);
        });
    } else {
        // Fallback for older browsers
        fallbackCopy(command);
    }
}

function fallbackCopy(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        showCopyFeedback();
    } catch (err) {
        console.error('Failed to copy text: ', err);
    }
    
    document.body.removeChild(textArea);
}

function showCopyFeedback() {
    const button = document.querySelector('.copy-btn');
    const originalText = button.textContent;
    
    button.textContent = 'Copied!';
    button.style.background = '#10b981';
    
    setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '';
    }, 2000);
}

// Attach copy button event listener
document.addEventListener('DOMContentLoaded', function() {
    const copyBtn = document.getElementById('copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyInstallCommand);
    }
});

// Smooth scrolling for navigation links
document.addEventListener('DOMContentLoaded', function() {
    const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            const targetSection = document.querySelector(targetId);
            
            if (targetSection) {
                const headerHeight = document.querySelector('.header').offsetHeight;
                const targetPosition = targetSection.offsetTop - headerHeight - 20;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
});

// Add scroll effect to header
window.addEventListener('scroll', function() {
    const header = document.querySelector('.header');
    
    if (window.scrollY > 100) {
        header.style.background = 'rgba(255, 255, 255, 0.98)';
        header.style.boxShadow = '0 1px 3px 0 rgb(0 0 0 / 0.1)';
    } else {
        header.style.background = 'rgba(255, 255, 255, 0.95)';
        header.style.boxShadow = 'none';
    }
});

// Terminal animation effect
document.addEventListener('DOMContentLoaded', function() {
    const terminalLines = document.querySelectorAll('.terminal-line');
    
    // Add typing animation to terminal lines
    function animateTerminal() {
        terminalLines.forEach((line, index) => {
            line.style.opacity = '0';
            line.style.transform = 'translateX(-10px)';
            
            setTimeout(() => {
                line.style.transition = 'all 0.5s ease';
                line.style.opacity = '1';
                line.style.transform = 'translateX(0)';
            }, index * 300);
        });
    }
    
    // Intersection Observer for terminal animation
    const terminalObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateTerminal();
                terminalObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });
    
    const terminal = document.querySelector('.terminal');
    if (terminal) {
        terminalObserver.observe(terminal);
    }
});

// Feature cards hover effect
document.addEventListener('DOMContentLoaded', function() {
    const featureCards = document.querySelectorAll('.feature-card');
    
    featureCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(-2px)';
        });
    });
});

// Analytics tracking (optional)
function trackEvent(eventName, properties = {}) {
    // Add your analytics tracking here
    // Example: gtag('event', eventName, properties);
    console.log('Event tracked:', eventName, properties);
}

// Track button clicks
document.addEventListener('click', function(e) {
    if (e.target.matches('.copy-btn')) {
        trackEvent('copy_install_command');
    }
    
    if (e.target.matches('.btn-primary')) {
        trackEvent('cta_click', { button: 'primary' });
    }
    
    if (e.target.matches('.btn-secondary')) {
        trackEvent('cta_click', { button: 'secondary' });
    }
});
