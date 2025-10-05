import Phaser from 'phaser';
import { State, repoAll, findFirstPlayer, repoGet } from '../core/state.js';
import { TimeState, getSimDate, getSimDayNumber } from '../core/time.js';

export default class UIScene extends Phaser.Scene {
    constructor() {
        super('UI');
        this.actionButtons = []; // Almacenará los botones para desactivación dinámica
    }

    create() {
        const screenWidth = this.scale.width;
        const screenHeight = this.scale.height;

        // Paleta de colores OFICIAL "Low Poly Eco-Futurista Dual"
        const colors = {
            // Paleta Tierra (Acciones / Fondos del juego)
            panelBg: 0x9A6B41,
            panelBorder: 0x5B3A29,
            actionButton: 0x8DA86C,
            actionButtonHover: 0x79a83c,
            actionButtonDisabled: 0x5E7A47,
            
            // Paleta Espacio/Data (Status / Diagramas)
            dataPanelBg: 0x1a202c, // Gris azulado oscuro para el panel de Status
            dataAccent: 0x00FFD1, // Turquesa NASA para acentos científicos
            
            // Textos
            textPrimary: '#F4F0E1',
            textSecondary: '#E6D6A6',
            
            // Barras de HUD
            bar: {
                // NDVI es la métrica satelital clave, usa Turquesa NASA como acento
                hp: 0x00FFD1, // Turquesa NASA (NDVI/Salud)
                heat: 0xf87171, // Rojo (Estrés por Calor)
                water: 0x60a5fa, // Azul (SMAP/Humedad)
                humidity: 0xfbbf24, // Amarillo (Atm.)
                money: 0xf59e0b, // Naranja
                energy: 0xc084fc // Púrpura
            },
            feedback: { success: 0x00FFD1, error: 0xf87171 }
        };

        // Panel Izquierdo (Status - Data/Espacio)
        this.statusPanel = this.createCollapsiblePanel(0, 0, 320, screenHeight, 'left', colors, colors.dataPanelBg);
        this.populateStatusPanel(this.statusPanel, colors);

        // Panel Derecho (Acciones - Tierra/Game World)
        this.actionPanel = this.createCollapsiblePanel(screenWidth, 0, 280, screenHeight, 'right', colors, colors.panelBg);
        this.populateActionPanel(this.actionPanel, colors);
        
        // Almacenar colores para el update
        this.colors = colors;
    }

    createCollapsiblePanel(x, y, width, height, side, colors, bgColor) {
        const container = this.add.container(x, y);
        if (side === 'right') container.x -= width;

        const panelBg = this.add.graphics().fillStyle(bgColor, 0.9).fillRoundedRect(0, 0, width, height, (side === 'left' ? { tr: 16, br: 16 } : { tl: 16, bl: 16 }));
        panelBg.lineStyle(4, colors.panelBorder).strokeRoundedRect(0, 0, width, height, (side === 'left' ? { tr: 16, br: 16 } : { tl: 16, bl: 16 }));
        container.add(panelBg);

        const toggleButton = this.add.text(side === 'left' ? width - 25 : 25, height / 2, side === 'left' ? '◀' : '▶', { fontSize: '32px', color: colors.textPrimary, fontStyle: 'bold' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        container.add(toggleButton);

        let isCollapsed = false;
        toggleButton.on('pointerdown', () => {
            isCollapsed = !isCollapsed;
            this.tweens.add({ targets: container, x: isCollapsed ? (side === 'left' ? -width + 50 : this.scale.width - 50) : (side === 'left' ? 0 : this.scale.width - width), duration: 300, ease: 'Cubic.easeInOut' });
            toggleButton.setText(isCollapsed ? (side === 'left' ? '▶' : '◀') : (side === 'left' ? '◀' : '▶'));
        });

        return { container, width, height, side };
    }

    populateStatusPanel(panel, colors) {
        const container = panel.container;
        const panelWidth = panel.width;
        let currentY = 24;

        this.playerNameText = this.add.text(panelWidth / 2, currentY, 'Agente', { fontSize: '28px', color: colors.dataAccent, fontStyle: 'bold' }).setOrigin(0.5, 0); // Nombre con acento Turquesa
        this.locationText = this.add.text(panelWidth / 2, currentY += 35, 'Pampa Húmeda, AR', { fontSize: '20px', color: colors.textSecondary }).setOrigin(0.5, 0);
        
        // Estilo mejorado para el Día (resaltando el avance del tiempo)
        this.dayText = this.add.text(panelWidth / 2, currentY += 35, 'Día: 1', { 
            fontSize: '20px', color: colors.textPrimary, fontStyle: '600', 
            backgroundColor: Phaser.Display.Color.IntegerToColor(colors.dataAccent).rgba, // Fondo Turquesa NASA
            padding: { x: 16, y: 8 }, align: 'center', 
            cornerRadius: 8 
        }).setOrigin(0.5, 0);
        
        currentY += 60;
        
        // Títulos de las barras actualizados para reflejar la Data Trinity
        this.bars = {
            hp: this.createHudBar('SALUD (NDVI)', currentY, colors.bar.hp, panelWidth, colors),
            heat: this.createHudBar('CALOR (Estrés)', currentY += 70, colors.bar.heat, panelWidth, colors),
            water: this.createHudBar('HUMEDAD (SMAP RZSM)', currentY += 70, colors.bar.water, panelWidth, colors),
            humidity: this.createHudBar('LLUVIA (GPM)', currentY += 70, colors.bar.humidity, panelWidth, colors), // GPM como indicador de entrada
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
        const title = this.add.text(panelWidth / 2, currentY, 'Decisiones', { fontSize: '28px', color: colors.textPrimary, fontStyle: 'bold' }).setOrigin(0.5, 0);
        currentY += 70;

        // --- BOTONES CLAVE (DECISIONES AGRÍCOLAS) ---
        this.actionButtons = []; // Reinicializar y usar this.actionButtons para el loop de update
        
        this.actionButtons.push(this.createActionButton('💧 Regar', currentY, () => {
            this.game.events.emit('action:perform', { actionType: 'REGAR' });
            this.showActionFeedback('💧 Riego ejecutado', colors.feedback.success);
        }, panelWidth, colors));

        this.actionButtons.push(this.createActionButton('🌱 Sembrar', currentY += 65, () => {
            this.game.events.emit('action:perform', { actionType: 'SEMBRAR' });
            this.showActionFeedback('🌱 Siembra iniciada', colors.feedback.success);
        }, panelWidth, colors));

        this.actionButtons.push(this.createActionButton('🌾 Cosechar', currentY += 65, () => {
            this.game.events.emit('action:perform', { actionType: 'COSECHAR' });
             this.showActionFeedback('🌾 Cosecha intentada', 0xfbbf24); // Feedback diferente
        }, panelWidth, colors));

        // Separador visual
        const separator = this.add.graphics().fillStyle(colors.panelBorder, 0.5).fillRect(16, currentY += 55, panelWidth - 32, 2);
        container.add(separator);
        currentY += 15;

        // --- BOTONES AVANZADOS (ESTRATEGIA / TECNOLOGÍA) ---
        this.actionButtons.push(this.createActionButton('⚙️ Mejorar', currentY, () => {
            this.game.events.emit('action:perform', { actionType: 'UPGRADE_TECH' });
             this.showActionFeedback('⚙️ Abriendo Tech-Tree', colors.dataAccent); // Feedback con acento NASA
        }, panelWidth, colors));
        
        this.actionButtons.push(this.createActionButton('🛰️ Escanear (Data)', currentY += 65, () => {
            this.game.events.emit('action:perform', { actionType: 'SCAN_REGION' });
            this.showActionFeedback('🛰️ Extrayendo Data NASA...', colors.dataAccent);
        }, panelWidth, colors));
        
        this.actionButtons.push(this.createActionButton('💰 Vender Cosecha', currentY += 65, () => {
            this.game.events.emit('action:perform', { actionType: 'SELL_HARVEST' });
            this.showActionFeedback('💰 Mercado actualizado', colors.bar.money);
        }, panelWidth, colors));

        container.add([title, ...this.actionButtons.map(b => b.elements).flat()]);
    }
    
    showActionFeedback(msg, colorHex) {
        const feedbackText = this.add.text(this.scale.width / 2, this.scale.height - 100, msg, {
            fontSize: '24px', 
            color: Phaser.Display.Color.IntegerToColor(colorHex).rgba,
            fontStyle: 'bold', 
            backgroundColor: 'rgba(0,0,0,0.7)',
            padding: { x: 20, y: 10 }, 
            borderRadius: 10 // Cambiado a borderRadius para mayor compatibilidad
        }).setOrigin(0.5);

        this.tweens.add({
            targets: feedbackText, 
            y: feedbackText.y - 70, 
            alpha: 0,
            duration: 1500, 
            ease: 'Cubic.easeOut',
            onComplete: () => feedbackText.destroy()
        });
    }

    createHudBar(label, y, color, panelWidth, colors) {
        const panelPadding = 24; const barWidth = panelWidth - (panelPadding * 2);
        
        // Título de la barra (NDVI y SMAP son conceptos clave a memorizar)
        const labelText = this.add.text(panelPadding, y, label, { 
            fontSize: '16px', 
            color: label.includes('NDVI') || label.includes('SMAP') ? colors.dataAccent : colors.textPrimary, // Resaltar Data Trinity
            fontStyle: 'bold' 
        });

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
                // El texto de dinero muestra el valor real, no un porcentaje
                let displayValue = (label.includes('DINERO')) ? `$${(value * 10000).toFixed(0)}` : `${(value * 100).toFixed(0)}%`;
                
                valueText.setText(displayValue);
                valueBar.clear();
                valueBar.fillStyle(color);
                valueBar.fillRoundedRect(panelPadding + 3, y + 28, (barWidth - 6) * value, 24, 12);
            }
        };
    }
    
    createActionButton(text, y, onClick, panelWidth, colors) {
        const panelPadding = 24; const buttonWidth = panelWidth - (panelPadding * 2);
        const buttonBg = this.add.graphics().fillStyle(colors.actionButton).fillRoundedRect(panelPadding, y, buttonWidth, 55, 16);
        const buttonText = this.add.text(panelWidth / 2, y + 27.5, text, { fontSize: '22px', color: colors.textPrimary, fontStyle: 'bold' }).setOrigin(0.5);
        
        const hitArea = new Phaser.Geom.Rectangle(panelPadding, y, buttonWidth, 55);
        buttonBg.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);

        // --- FEEDBACK TÁCTIL MEJORADO ---
        buttonBg.on('pointerdown', () => {
            if (buttonBg.input.enabled) {
                this.tweens.add({ targets: [buttonBg, buttonText], scale: 0.95, duration: 80, yoyo: true, ease: 'Quad.easeInOut' });
                onClick();
            }
        });
        buttonBg.on('pointerover', () => { if(buttonBg.input.enabled) buttonBg.fillColor = colors.actionButtonHover; });
        buttonBg.on('pointerout', () => { if(buttonBg.input.enabled) buttonBg.fillColor = colors.actionButton; });
        
        return { elements: [buttonBg, buttonText], bg: buttonBg, text: buttonText };
    }

    update() {
        // La variable useMockState se define dentro de update() en la versión original.
        // La mantendremos para fines de demostración de UI.
        const useMockState = true; 
        
        // Variables de estado real
        let hasEnergy = true; 
        let canAfford = true;
        const colors = this.colors; // Usar los colores almacenados en 'this'
        
        // --- 1. Lógica de Actualización de Barras ---
        if (useMockState) {
            // MOCK STATE (para demo)
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
                this.bars[key].update(Phaser.Math.Clamp(mockState[key], 0, 1));
            });
            hasEnergy = mockState.energy > 0.1; // Menos del 10% es sin energía
            canAfford = mockState.money > 0.1; 
        } else {
            // LÓGICA DE ESTADO REAL (A IMPLEMENTAR)
            const player = findFirstPlayer();
            const parcela = player ? repoGet('parcelas', player.parcelaSeleccionadaId) : null;
            
            if (parcela) { 
                // Actualizar barras de parcela (NDVI, SMAP, etc.)
                this.bars.hp.update(parcela.saludNDVI || 0); // NDVI
                this.bars.water.update(parcela.humedadSueloSMAP || 0); // SMAP
                this.bars.heat.update(parcela.estresTermico || 0); // Estrés Térmico (inverso: 1 - estres)
            }
            if (player) {
                // Actualizar barras de jugador (Money, Energy)
                this.bars.money.update(player.cartera / 10000); // 10000 como máximo asumido
                this.bars.energy.update(player.energiaActual / player.energiaMax);
                hasEnergy = player.energiaActual > (player.energiaMax * 0.1);
                canAfford = player.cartera > 50; // Asumimos 50 como coste mínimo
            }
        }
        
        // --- 2. Lógica de Desactivación Dinámica ---
        this.actionButtons.forEach(button => {
            // Lógica simplificada: Desactivar si no hay energía O no hay dinero
            const isEnabled = hasEnergy && canAfford; 
            
            button.bg.setAlpha(isEnabled ? 1 : 0.5);
            
            if (isEnabled) {
                // Activar interacciones
                if (!button.bg.input.enabled) {
                    button.bg.setInteractive({ useHandCursor: true });
                    button.bg.fillColor = colors.actionButton;
                }
            } else {
                // Desactivar interacciones
                if (button.bg.input.enabled) {
                    button.bg.disableInteractive();
                    button.bg.fillColor = colors.actionButtonDisabled;
                }
            }
        });
        
        // --- 3. Actualización de Textos ---
        this.dayText.setText(`Día: ${getSimDayNumber()}`);
        const player = findFirstPlayer();
        if(player && window.__CV_START__?.profile?.name) {
             // Asume que el nombre real se guarda al iniciar
            this.playerNameText.setText(window.__CV_START__.profile.name); 
        }
    }
}