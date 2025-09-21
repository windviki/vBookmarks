/**
 * vBookmarks Compatibility Script
 * 兼容性脚本 - 处理主题管理和搜索功能
 */

// 主题管理
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
        themeIcon.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    }
}

// 搜索功能
function clearSearch() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.querySelector('.search-clear');

    if (searchInput) {
        searchInput.value = '';
    }
    if (clearBtn) {
        clearBtn.classList.remove('visible');
    }
    if (searchInput) {
        searchInput.focus();
    }
}

// 初始化主题
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
        themeIcon.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    }
});

// 搜索输入处理
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.querySelector('.search-clear');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const hasValue = e.target.value.length > 0;
            if (clearBtn) {
                clearBtn.classList.toggle('visible', hasValue);
            }
        });
    }
});

// 导出函数到全局作用域，以便HTML中的onclick事件可以使用
window.toggleTheme = toggleTheme;
window.clearSearch = clearSearch;