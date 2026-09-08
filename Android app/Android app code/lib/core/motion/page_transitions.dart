import 'package:flutter/material.dart';
import 'app_motion.dart';

/// Accessible, standard page transition route for ZdexCloud Android
class ZdexPageRoute<T> extends PageRouteBuilder<T> {
  final Widget page;

  ZdexPageRoute({
    required this.page,
    super.settings,
  }) : super(
          pageBuilder: (context, animation, secondaryAnimation) => page,
          transitionDuration: AppMotion.moderate,
          reverseTransitionDuration: AppMotion.fast,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            if (AppMotion.isReducedMotion(context)) {
              return child;
            }

            final curvedAnimation = CurvedAnimation(
              parent: animation,
              curve: AppMotion.emphasized,
              reverseCurve: AppMotion.exit,
            );

            return FadeTransition(
              opacity: curvedAnimation,
              child: SlideTransition(
                position: Tween<Offset>(
                  begin: const Offset(0.0, 0.04), // subtle 4% slide up
                  end: Offset.zero,
                ).animate(curvedAnimation),
                child: child,
              ),
            );
          },
        );
}

/// Reusable entrance animation widget for content sections
class AppFadeSlideTransition extends StatefulWidget {
  final Widget child;
  final Duration delay;
  final Duration duration;
  final double slideOffset;

  const AppFadeSlideTransition({
    super.key,
    required this.child,
    this.delay = Duration.zero,
    this.duration = AppMotion.moderate,
    this.slideOffset = AppMotion.distanceSm,
  });

  @override
  State<AppFadeSlideTransition> createState() => _AppFadeSlideTransitionState();
}

class _AppFadeSlideTransitionState extends State<AppFadeSlideTransition>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _fadeAnimation;
  late Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.duration,
    );

    final curve = CurvedAnimation(
      parent: _controller,
      curve: AppMotion.emphasized,
    );

    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(curve);
    _slideAnimation = Tween<Offset>(
      begin: Offset(0.0, widget.slideOffset / 100.0),
      end: Offset.zero,
    ).animate(curve);

    if (widget.delay == Duration.zero) {
      _controller.forward();
    } else {
      Future.delayed(widget.delay, () {
        if (mounted) {
          _controller.forward();
        }
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (AppMotion.isReducedMotion(context)) {
      return widget.child;
    }

    return FadeTransition(
      opacity: _fadeAnimation,
      child: SlideTransition(
        position: _slideAnimation,
        child: widget.child,
      ),
    );
  }
}
