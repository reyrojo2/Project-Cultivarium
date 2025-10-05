import Phaser from 'phaser';
import { State, repoAll, findFirstPlayer, repoGet } from '../core/state.js';
import { TimeState, getSimDate, getSimDayNumber } from '../core/time.js';

export default class UIScene extends Phaser.Scene {
    constructor() {
        super('UI');
    }

    create() {
        const screenWidth = this.scale.width;
        const screenHeight = this.scale.height;

        // Paleta de colores oficial "Cultivarium"
        const colors = {
            panelBg: 0x9A6B41,
            panelBorder: 0x5B3A29,
            textPrimary: '#F4F0E1',
            textSecondary: '#E6D6A6',
            actionButton: 0x8DA86C,
            actionButtonHover: 0x79a83c,
            bar: {
                hp: 0x4ade80,       // Verde
                heat: 0xf87171,     // Rojo
                water: 0x60a5fa,    // Azul
                humidity: 0xfbbf24, // Amarillo
                money: 0xf59e0b,     // Naranja
                energy: 0xc084fc      // Púrpura
            }
        };

        // --- PANEL IZQUIERDO (ESTADO) PLEGABLE ---
        this.statusPanel = this.createCollapsiblePanel(0, 0, 320, screenHeight, 'left', colors);
        this.populateStatusPanel(this.statusPanel, colors);

        // --- PANEL DERECHO (ACCIONES) PLEGABLE ---
        this.actionPanel = this.createCollapsiblePanel(screenWidth, 0, 280, screenHeight, 'right', colors);
        this.populateActionPanel(this.actionPanel, colors);
    }

    createCollapsiblePanel(x, y, width, height, side, colors) {
        // Un contenedor agrupa todos los elementos del panel
        const container = this.add.container(x, y);
        if (side === 'right') container.x -= width; // Ajuste inicial para el panel derecho

        // Fondo del panel
        const panelBg = this.add.graphics();
        panelBg.fillStyle(colors.panelBg, 0.9);
        const cornerRadius = (side === 'left') ? { tr: 24, br: 24 } : { tl: 24, bl: 24 };
        panelBg.fillRoundedRect(0, 0, width, height, cornerRadius);
        panelBg.lineStyle(4, colors.panelBorder);
        panelBg.strokeRoundedRect(0, 0, width, height, cornerRadius);
        
        container.add(panelBg);
        
        // Botón para plegar/desplegar
        const toggleButton = this.add.text(
            side === 'left' ? width - 25 : 25, 
            height / 2, 
            side === 'left' ? '◀' : '▶', 
            { fontSize: '32px', color: colors.textPrimary, fontStyle: 'bold' }
        ).setOrigin(0.5).setInteractive({ useHandCursor: true });

        container.add(toggleButton);

        let isCollapsed = false;
        toggleButton.on('pointerdown', () => {
            isCollapsed = !isCollapsed;
            // Animación de desplazamiento
            this.tweens.add({
                targets: container,
                x: isCollapsed ? (side === 'left' ? -width + 50 : this.scale.width - 50) : (side === 'left' ? 0 : this.scale.width - width),
                duration: 300,
                ease: 'Cubic.easeInOut'
            });
            toggleButton.setText(isCollapsed ? (side === 'left' ? '▶' : '◀') : (side === 'left' ? '◀' : '▶'));
        });

        return { container, width, height, side };
    }

    populateStatusPanel(panel, colors) {
        const container = panel.container;
        const panelWidth = panel.width;
        let currentY = 24;

        // Info del jugador
        this.playerNameText = this.add.text(panelWidth / 2, currentY, 'Agente', { fontSize: '28px', color: colors.textPrimary, fontStyle: 'bold' }).setOrigin(0.5, 0);
        this.locationText = this.add.text(panelWidth / 2, currentY += 35, 'Perú', { fontSize: '20px', color: colors.textSecondary }).setOrigin(0.5, 0);
        this.dayText = this.add.text(panelWidth / 2, currentY += 35, 'Día: 1', { fontSize: '20px', color: colors.textPrimary, fontStyle: '600', backgroundColor: 'rgba(0,0,0,0.2)', padding: { x: 16, y: 8 }, align: 'center', cornerRadius: 8 }).setOrigin(0.5, 0);
        currentY += 60;

        // Barras de estado
        this.bars = {
            hp: this.createHudBar('SALUD (NDVI)', currentY, colors.bar.hp, panelWidth, colors),
            heat: this.createHudBar('CALOR (Estrés)', currentY += 70, colors.bar.heat, panelWidth, colors),
            water: this.createHudBar('AGUA (SMAP)', currentY += 70, colors.bar.water, panelWidth, colors),
            humidity: this.createHudBar('HUMEDAD (Atm.)', currentY += 70, colors.bar.humidity, panelWidth, colors),
            money: this.createHudBar('DINERO ($)', currentY += 70, colors.bar.money, panelWidth, colors),
            energy: this.createHudBar('ENERGÍA (⚡)', currentY += 70, colors.bar.energy, panelWidth, colors),
        };
        
        Object.values(this.bars).forEach(bar => container.add(bar.elements));
        container.add([this.playerNameText, this.locationText, this.dayText]);
    }
    
    populateActionPanel(panel, colors) {
        const container = panel.container;
        const panelWidth = panel.width;
        let currentY = 24;
        const title = this.add.text(panelWidth / 2, currentY, 'Acciones', { fontSize: '28px', color: colors.textPrimary, fontStyle: 'bold' }).setOrigin(0.5, 0);
        currentY += 70;

        const actionButtons = [
            this.createActionButton('💧 Regar', currentY, () => this.game.events.emit('action:perform', { actionType: 'REGAR' }), panelWidth, colors),
            this.createActionButton('🌱 Sembrar', currentY += 70, () => this.game.events.emit('action:perform', { actionType: 'SEMBRAR' }), panelWidth, colors),
            this.createActionButton('🌾 Cosechar', currentY += 70, () => this.game.events.emit('action:perform', { actionType: 'COSECHAR' }), panelWidth, colors),
        ];

        container.add([title, ...actionButtons.flat()]);
    }

    createHudBar(label, y, color, panelWidth, colors) {
        const panelPadding = 24;
        const barWidth = panelWidth - (panelPadding * 2);
        
        const labelText = this.add.text(panelPadding, y, label, { fontSize: '16px', color: colors.textPrimary, fontStyle: 'bold' });
        const valueText = this.add.text(panelWidth - panelPadding, y, '0%', { fontSize: '16px', color: colors.textSecondary, fontStyle: 'bold' }).setOrigin(1, 0);
        
        const bgBar = this.add.graphics();
        bgBar.fillStyle(0x000000, 0.3);
        bgBar.fillRoundedRect(panelPadding, y + 25, barWidth, 30, 15);
        bgBar.lineStyle(2, colors.panelBorder);
        bgBar.strokeRoundedRect(panelPadding, y + 25, barWidth, 30, 15);

        const valueBar = this.add.graphics();
        
        return { 
            elements: [labelText, valueText, bgBar, valueBar], 
            update: (value) => { // value es un número entre 0 y 1
                value = Phaser.Math.Clamp(value, 0, 1);
                valueText.setText(`${(value * 100).toFixed(0)}%`);
                valueBar.clear();
                valueBar.fillStyle(color);
                valueBar.fillRoundedRect(panelPadding + 3, y + 28, (barWidth - 6) * value, 24, 12);
            }
        };
    }
    
    createActionButton(text, y, onClick, panelWidth, colors) {
        const panelPadding = 24;
        const buttonWidth = panelWidth - (panelPadding * 2);

        const buttonBg = this.add.graphics();
        buttonBg.fillStyle(colors.actionButton);
        buttonBg.fillRoundedRect(panelPadding, y, buttonWidth, 60, 16);
        
        const buttonText = this.add.text(panelWidth / 2, y + 30, text, { fontSize: '24px', color: colors.textPrimary, fontStyle: 'bold' }).setOrigin(0.5);

        const hitArea = new Phaser.Geom.Rectangle(panelPadding, y, buttonWidth, 60);
        buttonBg.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains).on('pointerdown', onClick);
        
        buttonBg.on('pointerover', () => buttonBg.fillColor = colors.actionButtonHover);
        buttonBg.on('pointerout', () => buttonBg.fillColor = colors.actionButton);
        
        return [buttonBg, buttonText];
    }

    update() {
        // Por ahora, usamos mockState para ver la UI animada.
        // La misión es reemplazar esto con los datos reales del juego.
        const useMockState = true;
        
        if (useMockState) {
            const time = this.time.now;
            const mockState = {
                hp: 0.75 + Math.sin(time / 1000) * 0.25,
                heat: 0.40 + Math.cos(time / 800) * 0.30,
                water: 0.50 + Math.sin(time / 1200) * 0.40,
                humidity: 0.60 + Math.cos(time / 1500) * 0.10,
                money: 0.85 + Math.sin(time / 2000) * 0.05,
                energy: 0.90 + Math.cos(time / 500) * 0.10
            };
            Object.keys(this.bars).forEach(key => {
                this.bars[key].update(mockState[key]);
            });
        } else {
            // CÓDIGO FINAL: Conectar al estado real del juego
            const player = findFirstPlayer();
            const parcela = player ? repoGet('parcelas', player.parcelaSeleccionadaId) : null;
            if (parcela) {
                const cultivo = parcela.cultivoId ? repoGet('cultivos', parcela.cultivoId) : null;
                const agua = parcela.aguaId ? repoGet('recursos', parcela.aguaId) : null;
                this.bars.hp.update(cultivo ? cultivo.progreso : 0);
                this.bars.water.update(agua ? agua.nivel : 0);
            }
            this.bars.money.update(player ? player.cartera / 10000 : 0); // Asumiendo un máximo de 10,000
        }

        // Actualizar textos que dependen del estado del tiempo y jugador
        this.dayText.setText(`Día: ${getSimDayNumber()}`);
        const player = findFirstPlayer();
        if(player) {
            this.playerNameText.setText(window.__CV_START__?.profile?.name || 'Agente');
        }
    }
}
